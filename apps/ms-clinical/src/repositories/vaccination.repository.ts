import type {
  Vaccination as PrismaVaccination,
  VaccinationAnimal as PrismaVaccinationAnimal,
} from '../../node_modules/.prisma/client-clinical';
import type { RequestContext, UUID, Paginated, Vaccination, DomainEvent } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { prisma, withTenant } from '../prisma';
import { enqueueOutboxEvent } from './outbox.repository';
import type { ListVaccinationsInput } from '../schemas/vaccination.schema';

/** Já com cópias e valores calculados pelo service. */
export interface CreateVaccinationData {
  ownerId: string;
  propertyId: string;
  veterinarianId: string;
  productId: string;
  vaccineName: string;
  vaccineBatch: string | null;
  animalIds: string[];
  dosesPerAnimal: number;
  appliedAt: Date;
  doseIntervalDays: number | null;
  nextDoseAt: Date | null;
  pricePerDoseCents: number;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
  totalCents: number;
  notes: string | null;
}

/** Uma linha por (aplicação, animal) ainda não re-vacinado — o que o lembrete precisa. */
export interface DueVaccinationRow {
  id: string;
  tenantId: string;
  ownerId: string;
  propertyId: string;
  veterinarianId: string;
  vaccineName: string;
  nextDoseAt: Date;
  animalId: string;
}

interface DueVaccinationSqlRow {
  id: string;
  tenant_id: string;
  owner_id: string;
  property_id: string;
  veterinarian_id: string;
  vaccine_name: string;
  next_dose_at: Date;
  animal_id: string;
}

const INCLUDE = { animals: true } as const;

/** Mais recente primeiro — a ordem que o histórico e o indicador de próxima dose usam. */
const NEWEST_FIRST = [{ appliedAt: 'desc' }, { createdAt: 'desc' }] as const;

type VaccinationRow = PrismaVaccination & { animals: PrismaVaccinationAnimal[] };

/**
 * Vacinações — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2), exceto a
 * leitura do lembrete, que é cross-tenant por função SECURITY DEFINER.
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class VaccinationRepository {
  async list(ctx: RequestContext, params: ListVaccinationsInput): Promise<Paginated<Vaccination>> {
    return this.paginate(ctx, params, {});
  }

  /** RF-VAC-004 */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListVaccinationsInput,
  ): Promise<Paginated<Vaccination>> {
    return this.paginate(ctx, params, { animals: { some: { animalId } } });
  }

  private async paginate(
    ctx: RequestContext,
    params: ListVaccinationsInput,
    filter: Record<string, unknown>,
  ): Promise<Paginated<Vaccination>> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null, ...filter };
      const [rows, total] = await Promise.all([
        tx.vaccination.findMany({ where, include: INCLUDE, skip, take: limit, orderBy: [...NEWEST_FIRST] }),
        tx.vaccination.count({ where }),
      ]);
      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  /**
   * TODAS as aplicações do animal, mais recente primeiro — o service fica
   * com a primeira de cada vacina. Não filtra por próxima dose de propósito:
   * se a aplicação mais recente não tem intervalo, não há próxima dose,
   * mesmo que uma antiga tivesse. Volume pequeno por animal (algumas por
   * ano), então não vale um DISTINCT ON em SQL cru.
   */
  async listAllByAnimal(ctx: RequestContext, animalId: UUID): Promise<Vaccination[]> {
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.vaccination.findMany({
        where: { deletedAt: null, animals: { some: { animalId } } },
        include: INCLUDE,
        orderBy: [...NEWEST_FIRST],
      });
      return rows.map(toDomain);
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Vaccination | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.vaccination.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
      return row ? toDomain(row) : null;
    });
  }

  /**
   * Aplicação e evento NA MESMA TRANSAÇÃO (ADR-002): ou a vacinação existe E
   * a baixa/cobrança vão sair, ou nada acontece. O evento depende do id
   * gerado, por isso vem como função.
   */
  async create(
    ctx: RequestContext,
    data: CreateVaccinationData,
    buildEvent: (created: Vaccination) => DomainEvent<unknown>,
  ): Promise<Vaccination> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { animalIds, ...fields } = data;
      const row = await tx.vaccination.create({
        data: {
          ...fields,
          tenantId: ctx.tenantId,
          animals: { create: animalIds.map((animalId) => ({ tenantId: ctx.tenantId, animalId })) },
        },
        include: INCLUDE,
      });
      const created = toDomain(row);
      await enqueueOutboxEvent(tx, ctx.tenantId, buildEvent(created));
      return created;
    });
  }

  /** Exclusão e evento juntos; condicionado a ainda não ter sido excluída. */
  async softDelete(ctx: RequestContext, id: UUID, event: DomainEvent<unknown> | null): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.vaccination.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw AppError.notFound('Vacinação não encontrada');
      if (event) await enqueueOutboxEvent(tx, ctx.tenantId, event);
    });
  }

  /**
   * Lembrete de re-vacinação: varre TODOS os tenants pela função SECURITY
   * DEFINER (ADR-006). A janela vem do service, que decide o que é "dia" no
   * fuso de São Paulo. Os ::timestamptz evitam o tropeço de tipo já visto
   * na leitura do lembrete de exame.
   */
  async listDueAcrossTenants(from: Date, to: Date): Promise<DueVaccinationRow[]> {
    const rows = await prisma.$queryRaw<DueVaccinationSqlRow[]>`
      SELECT * FROM clinical_list_vaccinations_due(${from}::timestamptz, ${to}::timestamptz)
    `;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ownerId: row.owner_id,
      propertyId: row.property_id,
      veterinarianId: row.veterinarian_id,
      vaccineName: row.vaccine_name,
      nextDoseAt: row.next_dose_at,
      animalId: row.animal_id,
    }));
  }
}

function toDomain(row: VaccinationRow): Vaccination {
  return {
    id: row.id,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    veterinarianId: row.veterinarianId,
    productId: row.productId,
    vaccineName: row.vaccineName,
    vaccineBatch: row.vaccineBatch,
    animalIds: row.animals.map((a) => a.animalId),
    dosesPerAnimal: row.dosesPerAnimal.toNumber(),
    appliedAt: row.appliedAt.toISOString(),
    doseIntervalDays: row.doseIntervalDays,
    nextDoseAt: row.nextDoseAt ? row.nextDoseAt.toISOString() : null,
    pricePerDoseCents: row.pricePerDoseCents,
    laborCents: row.laborCents,
    displacementKm: row.displacementKm.toNumber(),
    displacementRateCents: row.displacementRateCents,
    totalCents: row.totalCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
