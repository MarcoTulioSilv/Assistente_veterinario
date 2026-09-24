import { createHash } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type {
  IAppointmentService,
  RequestContext,
  UUID,
  Paginated,
  Appointment,
  AppointmentDonePayload,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type {
  AppointmentRepository,
  CreateAppointmentData,
  UpdateAppointmentData,
  AppointmentItemData,
  PrescriptionData,
} from '../repositories/appointment.repository';
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsInput,
  AppointmentItemInput,
  PrescriptionInput,
} from '../schemas/appointment.schema';

interface BudgetInput {
  items: Array<{ totalCents: number }>;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
}

/**
 * RF-ATD-006: itens de estoque + procedimentos + mão de obra + deslocamento
 * (km × valor/km). Tudo em centavos inteiros (ADR-001 §5.6) — o arredondamento
 * do deslocamento acontece uma vez, no fim, e não por km.
 */
export function calculateTotalCents(input: BudgetInput): number {
  const itemsCents = input.items.reduce((sum, item) => sum + item.totalCents, 0);
  const displacementCents = Math.round(input.displacementKm * input.displacementRateCents);
  return itemsCents + input.laborCents + displacementCents;
}

export function calculateItemTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * Chave de idempotência do envelope, derivada do atendimento — nunca
 * aleatória.
 *
 * É o outro lado do problema documentado no DeductionService do MS2: lá, a
 * proteção cobre reentrega do MESMO evento (retry do BullMQ), mas não um
 * publisher que emita dois eventos com chaves diferentes pro mesmo
 * atendimento. Derivando do appointmentId, "dois eventos para o mesmo
 * atendimento" deixa de ser possível: a segunda gravação no outbox esbarra
 * na UNIQUE de idempotency_key.
 *
 * SHA-1 formatado como UUID pelo mesmo motivo do MS2 — `idempotency_key` é
 * coluna `@db.Uuid` de verdade, e o projeto evita o pacote `uuid`.
 */
export function deriveEventIdempotencyKey(eventName: string, appointmentId: string): UUID {
  const hex = createHash('sha1').update(`${eventName}:${appointmentId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * RN-003: só item de estoque vira baixa. Procedimento não tem produto e não
 * pode entrar no evento — o MS2 tentaria dar baixa num produto inexistente.
 */
export function toConsumedItems(appointment: Appointment): AppointmentDonePayload['consumedItems'] {
  return appointment.items
    .filter((item) => item.kind === 'product' && item.productId !== null)
    .map((item) => ({ productId: item.productId as UUID, quantity: item.quantity }));
}

export function buildAppointmentDoneEvent(
  ctx: RequestContext,
  appointment: Appointment,
  totalCents: number,
): DomainEvent<AppointmentDonePayload> {
  return {
    name: EVENTS.APPOINTMENT_DONE,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.APPOINTMENT_DONE, appointment.id),
    occurredAt: new Date().toISOString(),
    payload: {
      appointmentId: appointment.id,
      ownerId: appointment.ownerId,
      totalCostCents: totalCents,
      consumedItems: toConsumedItems(appointment),
    },
  };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IAppointmentService publicada em shared-types.
 */
export class AppointmentService implements IAppointmentService {
  constructor(private readonly repo: AppointmentRepository) {}

  async list(ctx: RequestContext, params: ListAppointmentsInput): Promise<Paginated<Appointment>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Appointment | null> {
    return this.repo.findById(ctx, id);
  }

  /** RF-ATD-011 */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListAppointmentsInput,
  ): Promise<Paginated<Appointment>> {
    return this.repo.listByAnimal(ctx, animalId, params);
  }

  async create(ctx: RequestContext, data: CreateAppointmentInput): Promise<Appointment> {
    return this.repo.create(ctx, this.toCreateData(data));
  }

  /**
   * Orçamento só muda enquanto rascunho. Depois de finalizado ele virou
   * pendência financeira no MS6 e evento de baixa no MS2 — mexer no valor
   * aqui deixaria os três fora de sincronia, sem nada no banco impedindo.
   */
  async update(ctx: RequestContext, id: UUID, data: UpdateAppointmentInput): Promise<Appointment> {
    const existing = await this.requireDraft(ctx, id);

    const items = data.items ? data.items.map(toItemData) : existing.items;
    const changes: UpdateAppointmentData = {
      ...(data.propertyId !== undefined ? { propertyId: data.propertyId } : {}),
      ...(data.veterinarianId !== undefined ? { veterinarianId: data.veterinarianId } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.animalLocation !== undefined ? { animalLocation: data.animalLocation } : {}),
      ...(data.performedAt !== undefined ? { performedAt: new Date(data.performedAt) } : {}),
      ...(data.laborCents !== undefined ? { laborCents: data.laborCents } : {}),
      ...(data.displacementKm !== undefined ? { displacementKm: data.displacementKm } : {}),
      ...(data.displacementRateCents !== undefined
        ? { displacementRateCents: data.displacementRateCents }
        : {}),
      ...(data.items ? { items: data.items.map(toItemData) } : {}),
      ...(data.prescriptions ? { prescriptions: data.prescriptions.map(toPrescriptionData) } : {}),
      ...(data.medicalRecord ? { medicalRecord: data.medicalRecord } : {}),
      totalCents: calculateTotalCents({
        items,
        laborCents: data.laborCents ?? existing.laborCents,
        displacementKm: data.displacementKm ?? existing.displacementKm,
        displacementRateCents: data.displacementRateCents ?? existing.displacementRateCents,
      }),
    };

    return this.repo.update(ctx, id, changes);
  }

  /**
   * RF-ATD-008 + RN-003. O total é recalculado a partir do que está gravado
   * (e não do que veio na última edição) porque é este número que congela:
   * vai no evento, na pendência financeira e na ficha.
   */
  async finish(ctx: RequestContext, id: UUID): Promise<Appointment> {
    const existing = await this.requireDraft(ctx, id);

    const totalCents = calculateTotalCents({
      items: existing.items,
      laborCents: existing.laborCents,
      displacementKm: existing.displacementKm,
      displacementRateCents: existing.displacementRateCents,
    });

    const event = buildAppointmentDoneEvent(ctx, existing, totalCents);
    return this.repo.finish(ctx, id, totalCents, event);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Atendimento não encontrado');
    await this.repo.softDelete(ctx, id);
  }

  /** ADR-001 §5.4: "status check antes de processar evento". */
  private async requireDraft(ctx: RequestContext, id: UUID): Promise<Appointment> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Atendimento não encontrado');
    if (existing.status !== 'draft') {
      throw AppError.conflict(
        `Atendimento ${existing.status === 'finished' ? 'já finalizado' : 'cancelado'} — orçamento congelado`,
      );
    }
    return existing;
  }

  private toCreateData(data: CreateAppointmentInput): CreateAppointmentData {
    const items = (data.items ?? []).map(toItemData);

    return {
      ownerId: data.ownerId,
      propertyId: data.propertyId,
      animalId: data.animalId,
      veterinarianId: data.veterinarianId,
      type: data.type,
      animalLocation: data.animalLocation ?? null,
      performedAt: new Date(data.performedAt),
      laborCents: data.laborCents ?? 0,
      displacementKm: data.displacementKm ?? 0,
      displacementRateCents: data.displacementRateCents ?? 0,
      totalCents: calculateTotalCents({
        items,
        laborCents: data.laborCents ?? 0,
        displacementKm: data.displacementKm ?? 0,
        displacementRateCents: data.displacementRateCents ?? 0,
      }),
      items,
      prescriptions: (data.prescriptions ?? []).map(toPrescriptionData),
      medicalRecord: data.medicalRecord ?? null,
    };
  }
}

function toItemData(item: AppointmentItemInput): AppointmentItemData {
  return {
    kind: item.kind,
    productId: item.productId ?? null,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: calculateItemTotalCents(item.quantity, item.unitPriceCents),
  };
}

function toPrescriptionData(prescription: PrescriptionInput): PrescriptionData {
  return {
    productId: prescription.productId ?? null,
    medicationName: prescription.medicationName,
    dose: prescription.dose,
    route: prescription.route,
    schedule: prescription.schedule,
    applicationSite: prescription.applicationSite ?? null,
    notes: prescription.notes ?? null,
  };
}
