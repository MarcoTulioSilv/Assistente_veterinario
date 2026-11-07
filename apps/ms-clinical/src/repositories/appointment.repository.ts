import { Prisma } from '../../node_modules/.prisma/client-clinical';
import type {
  Appointment as PrismaAppointment,
  AppointmentAnimal as PrismaAppointmentAnimal,
  AppointmentItem as PrismaItem,
  Prescription as PrismaPrescription,
  MedicalRecord as PrismaMedicalRecord,
} from '../../node_modules/.prisma/client-clinical';
import type {
  RequestContext,
  UUID,
  Paginated,
  Appointment,
  AppointmentAnimal,
  AppointmentItem,
  Prescription,
  MedicalRecord,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { withTenant } from '../prisma';
import { enqueueOutboxEvent } from './outbox.repository';
import type { ListAppointmentsInput, MedicalRecordInput } from '../schemas/appointment.schema';

/** Item já com o total calculado pelo service — o repo não faz aritmética de negócio. */
export interface AppointmentItemData {
  productId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface PrescriptionData {
  productId: string | null;
  medicationName: string;
  dose: string;
  route: Prescription['route'];
  schedule: string;
  applicationSite: string | null;
  notes: string | null;
}

/**
 * Ficha e receita de UM animal. `undefined` = não mexe; na receita, uma
 * lista substitui a anterior inteira (a tela reenvia a receita toda).
 */
export interface AnimalClinicalData {
  animalId: string;
  medicalRecord?: MedicalRecordInput;
  prescriptions?: PrescriptionData[];
}

export interface CreateAppointmentData {
  ownerId: string;
  propertyId: string;
  veterinarianId: string;
  title: string;
  type: Appointment['type'];
  animalIds: string[];
  animalLocation: string | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  performedAt: Date;
  procedureDescription: string | null;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
  totalCents: number;
  items: AppointmentItemData[];
  clinical: AnimalClinicalData[];
}

export type UpdateAppointmentData = Partial<Omit<CreateAppointmentData, 'ownerId'>>;

const INCLUDE = {
  items: true,
  animals: { include: { medicalRecord: true, prescriptions: true } },
} as const;

type AppointmentRow = PrismaAppointment & {
  items: PrismaItem[];
  animals: Array<PrismaAppointmentAnimal & { medicalRecord: PrismaMedicalRecord | null; prescriptions: PrismaPrescription[] }>;
};

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class AppointmentRepository {
  async list(ctx: RequestContext, params: ListAppointmentsInput): Promise<Paginated<Appointment>> {
    return this.paginate(ctx, params, {});
  }

  /** RF-ATD-011: histórico completo do animal. */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListAppointmentsInput,
  ): Promise<Paginated<Appointment>> {
    return this.paginate(ctx, params, { animals: { some: { animalId } } });
  }

  private async paginate(
    ctx: RequestContext,
    params: ListAppointmentsInput,
    filter: Record<string, unknown>,
  ): Promise<Paginated<Appointment>> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null, ...(params.status ? { status: params.status } : {}), ...filter };

      const [rows, total] = await Promise.all([
        tx.appointment.findMany({
          where,
          include: INCLUDE,
          skip,
          take: limit,
          orderBy: { performedAt: 'desc' },
        }),
        tx.appointment.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Appointment | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.appointment.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
      return row ? toDomain(row) : null;
    });
  }

  async create(ctx: RequestContext, data: CreateAppointmentData): Promise<Appointment> {
    const clinicalByAnimal = new Map(data.clinical.map((c) => [c.animalId, c]));

    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.appointment.create({
        data: {
          tenantId: ctx.tenantId,
          ownerId: data.ownerId,
          propertyId: data.propertyId,
          veterinarianId: data.veterinarianId,
          title: data.title,
          type: data.type,
          animalLocation: data.animalLocation,
          locationLatitude: data.locationLatitude,
          locationLongitude: data.locationLongitude,
          performedAt: data.performedAt,
          procedureDescription: data.procedureDescription,
          laborCents: data.laborCents,
          displacementKm: data.displacementKm,
          displacementRateCents: data.displacementRateCents,
          totalCents: data.totalCents,
          items: { create: data.items.map((item) => ({ ...item, tenantId: ctx.tenantId })) },
          animals: {
            create: data.animalIds.map((animalId) => {
              const clinical = clinicalByAnimal.get(animalId);
              return {
                tenantId: ctx.tenantId,
                animalId,
                ...(clinical?.medicalRecord
                  ? { medicalRecord: { create: toMedicalRecordData(ctx.tenantId, clinical.medicalRecord) } }
                  : {}),
                ...(clinical?.prescriptions?.length
                  ? { prescriptions: { create: clinical.prescriptions.map((p) => ({ ...p, tenantId: ctx.tenantId })) } }
                  : {}),
              };
            }),
          },
        },
        include: INCLUDE,
      });

      return toDomain(row);
    });
  }

  /**
   * Só enquanto rascunho. O primeiro UPDATE é a trava: confere o status E
   * segura a linha. Antes o service checava o rascunho e o repositório
   * gravava sem condição — uma finalização concorrente entre os dois
   * deixava editar um orçamento já congelado (mesmo defeito que o exame já
   * evitava).
   *
   * Itens são substituídos por inteiro quando vêm no update — a tela
   * reenvia o orçamento todo. `animalIds` substitui a lista: animal que sai
   * leva a ficha e a receita dele (cascata da FK composta); o que fica
   * mantém as suas.
   */
  async update(ctx: RequestContext, id: UUID, data: UpdateAppointmentData): Promise<Appointment> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, status: 'draft', deletedAt: null },
        data: { updatedAt: new Date() },
      });
      if (count === 0) throw AppError.conflict('Atendimento já finalizado ou inexistente — orçamento congelado');

      if (data.animalIds) {
        await tx.appointmentAnimal.deleteMany({ where: { appointmentId: id, animalId: { notIn: data.animalIds } } });
        await tx.appointmentAnimal.createMany({
          data: data.animalIds.map((animalId) => ({ tenantId: ctx.tenantId, appointmentId: id, animalId })),
          skipDuplicates: true,
        });
      }

      if (data.items) {
        await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
      }

      for (const clinical of data.clinical ?? []) {
        const key = { appointmentId: id, animalId: clinical.animalId };
        if (clinical.medicalRecord) {
          const record = toMedicalRecordData(ctx.tenantId, clinical.medicalRecord);
          await tx.medicalRecord.upsert({
            where: { appointmentId_animalId: key },
            create: { ...record, ...key },
            update: record,
          });
        }
        if (clinical.prescriptions) {
          await tx.prescription.deleteMany({ where: key });
          await tx.prescription.createMany({
            data: clinical.prescriptions.map((p) => ({ ...p, ...key, tenantId: ctx.tenantId })),
          });
        }
      }

      const row = await tx.appointment.update({
        where: { id },
        data: {
          ...(data.propertyId !== undefined ? { propertyId: data.propertyId } : {}),
          ...(data.veterinarianId !== undefined ? { veterinarianId: data.veterinarianId } : {}),
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.animalLocation !== undefined ? { animalLocation: data.animalLocation } : {}),
          ...(data.locationLatitude !== undefined ? { locationLatitude: data.locationLatitude } : {}),
          ...(data.locationLongitude !== undefined ? { locationLongitude: data.locationLongitude } : {}),
          ...(data.performedAt !== undefined ? { performedAt: data.performedAt } : {}),
          ...(data.procedureDescription !== undefined ? { procedureDescription: data.procedureDescription } : {}),
          ...(data.laborCents !== undefined ? { laborCents: data.laborCents } : {}),
          ...(data.displacementKm !== undefined ? { displacementKm: data.displacementKm } : {}),
          ...(data.displacementRateCents !== undefined
            ? { displacementRateCents: data.displacementRateCents }
            : {}),
          ...(data.totalCents !== undefined ? { totalCents: data.totalCents } : {}),
          ...(data.items
            ? { items: { create: data.items.map((item) => ({ ...item, tenantId: ctx.tenantId })) } }
            : {}),
        },
        include: INCLUDE,
      });

      return toDomain(row);
    });
  }

  /**
   * RF-ATD-008 + RN-003, numa transação só: congela o orçamento e grava o
   * evento no outbox. Ou os dois acontecem, ou nenhum — é o que impede o
   * atendimento ficar finalizado sem nunca baixar estoque (ADR-002).
   *
   * O UPDATE é condicionado a `status: 'draft'` de propósito: duas chamadas
   * concorrentes de finish() não podem gerar dois eventos. A que perder a
   * corrida atualiza zero linhas e falha aqui — e mesmo que passasse, a
   * UNIQUE de idempotency_key no outbox barraria a segunda.
   */
  async finish(
    ctx: RequestContext,
    id: UUID,
    totalCents: number,
    event: DomainEvent<unknown>,
  ): Promise<Appointment> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, status: 'draft', deletedAt: null },
        data: { status: 'finished', finishedAt: new Date(), totalCents },
      });

      if (count === 0) {
        throw AppError.conflict('Atendimento já finalizado ou inexistente');
      }

      await enqueueOutboxEvent(tx, ctx.tenantId, event);

      const row = await tx.appointment.findFirstOrThrow({ where: { id }, include: INCLUDE });
      return toDomain(row);
    });
  }

  /**
   * Exclusão e evento na mesma transação (outbox, ADR-002): ou o atendimento
   * some E a pendência é cancelada, ou nada acontece.
   *
   * O UPDATE é condicionado ao status que o service viu. Sem isso, um
   * rascunho finalizado por outra requisição entre a leitura e a exclusão
   * seria apagado SEM publicar o evento — e a pendência do finish ficaria
   * órfã, exatamente o que esta regra existe pra impedir.
   */
  async softDelete(
    ctx: RequestContext,
    id: UUID,
    expectedStatus: Appointment['status'],
    event: DomainEvent<unknown> | null,
  ): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, status: expectedStatus, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      if (count === 0) {
        throw AppError.conflict('Atendimento mudou de estado ou já foi excluído — tente de novo');
      }

      if (event) await enqueueOutboxEvent(tx, ctx.tenantId, event);
    });
  }
}

/**
 * Coluna JSONB anulável no Prisma não aceita `null` puro no input (o tipo
 * exige `Prisma.DbNull`/`JsonNull`). Como "não veio no payload" e "veio
 * vazio" significam a mesma coisa aqui, a chave é simplesmente omitida —
 * o que também evita sobrescrever exame já gravado num update parcial.
 */
interface MedicalRecordWriteData {
  tenantId: string;
  anamnesis: string | null;
  diagnosis: string | null;
  treatment: string | null;
  prognosis: string | null;
  referral: string | null;
  generalExam?: Prisma.InputJsonValue;
  specialExams?: Prisma.InputJsonValue;
}

function toMedicalRecordData(tenantId: string, record: MedicalRecordInput): MedicalRecordWriteData {
  return {
    tenantId,
    anamnesis: record.anamnesis ?? null,
    diagnosis: record.diagnosis ?? null,
    treatment: record.treatment ?? null,
    prognosis: record.prognosis ?? null,
    referral: record.referral ?? null,
    ...(record.generalExam ? { generalExam: record.generalExam as Prisma.InputJsonValue } : {}),
    ...(record.specialExams ? { specialExams: record.specialExams as Prisma.InputJsonValue } : {}),
  };
}

function toItemDomain(row: PrismaItem): AppointmentItem {
  return {
    id: row.id,
    productId: row.productId,
    description: row.description,
    quantity: row.quantity.toNumber(),
    unitPriceCents: row.unitPriceCents,
    totalCents: row.totalCents,
  };
}

function toPrescriptionDomain(row: PrismaPrescription): Prescription {
  return {
    id: row.id,
    productId: row.productId,
    medicationName: row.medicationName,
    dose: row.dose,
    route: row.route,
    schedule: row.schedule,
    applicationSite: row.applicationSite,
    notes: row.notes,
  };
}

function toMedicalRecordDomain(row: PrismaMedicalRecord): MedicalRecord {
  return {
    id: row.id,
    anamnesis: row.anamnesis,
    generalExam: row.generalExam as Record<string, unknown> | null,
    specialExams: row.specialExams as Record<string, unknown> | null,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    prognosis: row.prognosis,
    referral: row.referral,
  };
}

function toAnimalDomain(row: AppointmentRow['animals'][number]): AppointmentAnimal {
  return {
    animalId: row.animalId,
    medicalRecord: row.medicalRecord ? toMedicalRecordDomain(row.medicalRecord) : null,
    prescriptions: row.prescriptions.map(toPrescriptionDomain),
  };
}

function toDomain(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    veterinarianId: row.veterinarianId,
    type: row.type,
    status: row.status,
    // Ordem estável na tela: a do animalId (a tabela não guarda posição).
    animals: [...row.animals].sort((a, b) => a.animalId.localeCompare(b.animalId)).map(toAnimalDomain),
    animalLocation: row.animalLocation,
    locationLatitude: row.locationLatitude ? row.locationLatitude.toNumber() : null,
    locationLongitude: row.locationLongitude ? row.locationLongitude.toNumber() : null,
    performedAt: row.performedAt.toISOString(),
    procedureDescription: row.procedureDescription,
    laborCents: row.laborCents,
    displacementKm: row.displacementKm.toNumber(),
    displacementRateCents: row.displacementRateCents,
    totalCents: row.totalCents,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toItemDomain),
  };
}
