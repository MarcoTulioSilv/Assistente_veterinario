import { EVENTS } from '@quironequine/shared-types';
import type {
  IVaccinationService,
  RequestContext,
  UUID,
  Paginated,
  Vaccination,
  VaccineBooster,
  VaccinationAppliedPayload,
  VaccinationDeletedPayload,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { VaccinationRepository } from '../repositories/vaccination.repository';
import type { CreateVaccinationInput, ListVaccinationsInput } from '../schemas/vaccination.schema';
import { calculateTotalCents, deriveEventIdempotencyKey } from './billing';
import { saoPauloDay, addDays } from './sao-paulo-day';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela do "próxima dose em breve" — a mesma antecedência do lembrete. */
export const BOOSTER_DUE_SOON_DAYS = 7;

/**
 * Registro com data no futuro não é aplicação, é agendamento — e agenda é
 * outro módulo (M3). Um dia de folga cobre fuso e relógio de celular
 * adiantado.
 */
const MAX_FUTURE_MS = DAY_MS;

/** Total de doses aplicadas — é o que o MS2 baixa (convertido em unidades). */
export function totalDoses(dosesPerAnimal: number, animals: number): number {
  return dosesPerAnimal * animals;
}

/**
 * RF-VAC-003: valor da vacina (preço por dose × doses) + mão de obra + km
 * rodado (RN-011). Centavos inteiros; a vacina arredonda uma vez, no fim.
 */
export function calculateVaccinationTotalCents(input: {
  pricePerDoseCents: number;
  doses: number;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
}): number {
  return calculateTotalCents({
    items: [{ totalCents: Math.round(input.pricePerDoseCents * input.doses) }],
    laborCents: input.laborCents,
    displacementKm: input.displacementKm,
    displacementRateCents: input.displacementRateCents,
  });
}

/** RF-VAC-005: aplicação + intervalo do produto. Sem intervalo, sem próxima dose. */
export function calculateNextDoseAt(appliedAt: Date, doseIntervalDays: number | null): Date | null {
  return doseIntervalDays === null ? null : new Date(appliedAt.getTime() + doseIntervalDays * DAY_MS);
}

/** Situação da próxima dose, pelo dia de São Paulo (o do veterinário). */
export function boosterStatus(nextDoseAt: Date, now: Date): VaccineBooster['status'] {
  const today = saoPauloDay(now);
  const due = saoPauloDay(nextDoseAt);
  if (due < today) return 'overdue';
  if (due <= addDays(today, BOOSTER_DUE_SOON_DAYS)) return 'due_soon';
  return 'scheduled';
}

/**
 * Próxima dose de cada vacina, a partir das aplicações do animal (mais
 * recente primeiro). Só a aplicação mais recente de cada vacina conta:
 * re-vacinar substitui a data anterior — e, se a mais recente não tem
 * intervalo, a vacina não tem próxima dose.
 */
export function toBoosters(newestFirst: Vaccination[], now: Date): VaccineBooster[] {
  const latestByProduct = new Map<string, Vaccination>();
  for (const vaccination of newestFirst) {
    if (!latestByProduct.has(vaccination.productId)) latestByProduct.set(vaccination.productId, vaccination);
  }

  const boosters: VaccineBooster[] = [];
  for (const latest of latestByProduct.values()) {
    if (latest.nextDoseAt === null) continue;
    boosters.push({
      productId: latest.productId,
      vaccineName: latest.vaccineName,
      lastVaccinationId: latest.id,
      lastAppliedAt: latest.appliedAt,
      nextDoseAt: latest.nextDoseAt,
      status: boosterStatus(new Date(latest.nextDoseAt), now),
    });
  }
  return boosters.sort((a, b) => a.nextDoseAt.localeCompare(b.nextDoseAt));
}

export function buildVaccinationAppliedEvent(
  ctx: RequestContext,
  vaccination: Vaccination,
): DomainEvent<VaccinationAppliedPayload> {
  return {
    name: EVENTS.VACCINATION_APPLIED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    // Uma aplicação só é registrada uma vez — a chave derivada do id é única.
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.VACCINATION_APPLIED, vaccination.id),
    occurredAt: new Date().toISOString(),
    payload: {
      vaccinationId: vaccination.id,
      ownerId: vaccination.ownerId,
      productId: vaccination.productId,
      totalDoses: totalDoses(vaccination.dosesPerAnimal, vaccination.animalIds.length),
      totalCostCents: vaccination.totalCents,
      performedAt: vaccination.appliedAt,
    },
  };
}

export function buildVaccinationDeletedEvent(
  ctx: RequestContext,
  vaccination: Vaccination,
): DomainEvent<VaccinationDeletedPayload> {
  return {
    name: EVENTS.VACCINATION_DELETED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.VACCINATION_DELETED, vaccination.id),
    occurredAt: new Date().toISOString(),
    payload: {
      vaccinationId: vaccination.id,
      ownerId: vaccination.ownerId,
      totalCostCents: vaccination.totalCents,
      performedAt: vaccination.appliedAt,
    },
  };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IVaccinationService publicada em shared-types.
 *
 * Registrar é aplicar (decisão do Marco): não há rascunho nem edição. O
 * registro grava a aplicação e o `vaccination.applied` juntos — o MS2 baixa
 * as doses (RN-007) e o MS6 abre a pendência (RN-002).
 */
export class VaccinationService implements IVaccinationService {
  constructor(
    private readonly repo: VaccinationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ctx: RequestContext, params: ListVaccinationsInput): Promise<Paginated<Vaccination>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Vaccination | null> {
    return this.repo.findById(ctx, id);
  }

  /** RF-VAC-004 */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListVaccinationsInput,
  ): Promise<Paginated<Vaccination>> {
    return this.repo.listByAnimal(ctx, animalId, params);
  }

  async listBoostersByAnimal(ctx: RequestContext, animalId: UUID): Promise<VaccineBooster[]> {
    return toBoosters(await this.repo.listAllByAnimal(ctx, animalId), this.now());
  }

  async create(ctx: RequestContext, data: CreateVaccinationInput): Promise<Vaccination> {
    const appliedAt = new Date(data.appliedAt);
    if (appliedAt.getTime() > this.now().getTime() + MAX_FUTURE_MS) {
      throw AppError.validation('Data de aplicação no futuro', [
        { field: 'appliedAt', message: 'Registre a vacinação depois de aplicada' },
      ]);
    }

    const animalIds = [...new Set(data.animalIds)];
    const dosesPerAnimal = data.dosesPerAnimal ?? 1;
    const doseIntervalDays = data.doseIntervalDays ?? null;
    const laborCents = data.laborCents ?? 0;
    const displacementKm = data.displacementKm ?? 0;
    const displacementRateCents = data.displacementRateCents ?? 0;

    return this.repo.create(
      ctx,
      {
        ownerId: data.ownerId,
        propertyId: data.propertyId,
        veterinarianId: data.veterinarianId,
        productId: data.productId,
        vaccineName: data.vaccineName,
        vaccineBatch: data.vaccineBatch ?? null,
        animalIds,
        dosesPerAnimal,
        appliedAt,
        doseIntervalDays,
        nextDoseAt: calculateNextDoseAt(appliedAt, doseIntervalDays),
        pricePerDoseCents: data.pricePerDoseCents,
        laborCents,
        displacementKm,
        displacementRateCents,
        totalCents: calculateVaccinationTotalCents({
          pricePerDoseCents: data.pricePerDoseCents,
          doses: totalDoses(dosesPerAnimal, animalIds.length),
          laborCents,
          displacementKm,
          displacementRateCents,
        }),
        notes: data.notes ?? null,
      },
      (created) => buildVaccinationAppliedEvent(ctx, created),
    );
  }

  /**
   * Só a aplicação que gerou cobrança avisa o MS6. Estoque não volta: a
   * vacina foi de fato aplicada.
   */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Vacinação não encontrada');

    const event = existing.totalCents > 0 ? buildVaccinationDeletedEvent(ctx, existing) : null;
    await this.repo.softDelete(ctx, id, event);
  }
}
