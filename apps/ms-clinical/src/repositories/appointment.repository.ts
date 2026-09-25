import { Prisma } from '../../node_modules/.prisma/client-clinical';
import type {
  Appointment as PrismaAppointment,
  AppointmentItem as PrismaItem,
  Prescription as PrismaPrescription,
  MedicalRecord as PrismaMedicalRecord,
} from '../../node_modules/.prisma/client-clinical';
import type {
  RequestContext,
  UUID,
  Paginated,
  Appointment,
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
  kind: 'product' | 'procedure';
  productId: string | null;
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

export interface CreateAppointmentData {
  ownerId: string;
  propertyId: string;
  animalId: string;
  veterinarianId: string;
  type: Appointment['type'];
  animalLocation: string | null;
  performedAt: Date;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
  totalCents: number;
  items: AppointmentItemData[];
  prescriptions: PrescriptionData[];
  medicalRecord: MedicalRecordInput | null;
}

export type UpdateAppointmentData = Partial<CreateAppointmentData>;

const INCLUDE = { items: true, prescriptions: true, medicalRecord: true } as const;

type AppointmentRow = PrismaAppointment & {
  items: PrismaItem[];
  prescriptions: PrismaPrescription[];
  medicalRecord: PrismaMedicalRecord | null;
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
    return this.paginate(ctx, params, { animalId });
  }

  private async paginate(
    ctx: RequestContext,
    params: ListAppointmentsInput,
    filter: Record<string, unknown>,
  ): Promise<Paginated<Appointment>> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null, ...filter };

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
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.appointment.create({
        data: {
          tenantId: ctx.tenantId,
          ownerId: data.ownerId,
          propertyId: data.propertyId,
          animalId: data.animalId,
          veterinarianId: data.veterinarianId,
          type: data.type,
          animalLocation: data.animalLocation,
          performedAt: data.performedAt,
          laborCents: data.laborCents,
          displacementKm: data.displacementKm,
          displacementRateCents: data.displacementRateCents,
          totalCents: data.totalCents,
          items: { create: data.items.map((item) => ({ ...item, tenantId: ctx.tenantId })) },
          prescriptions: {
            create: data.prescriptions.map((p) => ({ ...p, tenantId: ctx.tenantId })),
          },
          ...(data.medicalRecord
            ? { medicalRecord: { create: toMedicalRecordData(ctx.tenantId, data.medicalRecord) } }
            : {}),
        },
        include: INCLUDE,
      });

      return toDomain(row);
    });
  }

  /**
   * Itens e prescrições são substituídos por inteiro quando vêm no update —
   * editar linha a linha exigiria que o cliente carregasse os ids, e o
   * orçamento é sempre reenviado inteiro pela tela.
   */
  async update(ctx: RequestContext, id: UUID, data: UpdateAppointmentData): Promise<Appointment> {
    return withTenant(ctx.tenantId, async (tx) => {
      if (data.items) {
        await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
      }
      if (data.prescriptions) {
        await tx.prescription.deleteMany({ where: { appointmentId: id } });
      }

      const row = await tx.appointment.update({
        where: { id },
        data: {
          ...(data.propertyId !== undefined ? { propertyId: data.propertyId } : {}),
          ...(data.veterinarianId !== undefined ? { veterinarianId: data.veterinarianId } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.animalLocation !== undefined ? { animalLocation: data.animalLocation } : {}),
          ...(data.performedAt !== undefined ? { performedAt: data.performedAt } : {}),
          ...(data.laborCents !== undefined ? { laborCents: data.laborCents } : {}),
          ...(data.displacementKm !== undefined ? { displacementKm: data.displacementKm } : {}),
          ...(data.displacementRateCents !== undefined
            ? { displacementRateCents: data.displacementRateCents }
            : {}),
          ...(data.totalCents !== undefined ? { totalCents: data.totalCents } : {}),
          ...(data.items
            ? { items: { create: data.items.map((item) => ({ ...item, tenantId: ctx.tenantId })) } }
            : {}),
          ...(data.prescriptions
            ? {
                prescriptions: {
                  create: data.prescriptions.map((p) => ({ ...p, tenantId: ctx.tenantId })),
                },
              }
            : {}),
          ...(data.medicalRecord
            ? {
                medicalRecord: {
                  upsert: {
                    create: toMedicalRecordData(ctx.tenantId, data.medicalRecord),
                    update: toMedicalRecordData(ctx.tenantId, data.medicalRecord),
                  },
                },
              }
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

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.appointment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
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
    kind: row.kind,
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
    appointmentId: row.appointmentId,
    anamnesis: row.anamnesis,
    generalExam: row.generalExam as Record<string, unknown> | null,
    specialExams: row.specialExams as Record<string, unknown> | null,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    prognosis: row.prognosis,
    referral: row.referral,
  };
}

function toDomain(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    animalId: row.animalId,
    veterinarianId: row.veterinarianId,
    type: row.type,
    status: row.status,
    animalLocation: row.animalLocation,
    performedAt: row.performedAt.toISOString(),
    laborCents: row.laborCents,
    displacementKm: row.displacementKm.toNumber(),
    displacementRateCents: row.displacementRateCents,
    totalCents: row.totalCents,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toItemDomain),
    prescriptions: row.prescriptions.map(toPrescriptionDomain),
    medicalRecord: row.medicalRecord ? toMedicalRecordDomain(row.medicalRecord) : null,
  };
}
