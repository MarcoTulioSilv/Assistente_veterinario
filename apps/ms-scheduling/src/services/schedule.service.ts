import { SCHEDULE_LIMITS } from '@quironequine/shared-types';
import type {
  IScheduleService,
  RequestContext,
  UUID,
  ScheduleEvent,
  ScheduleActivityType,
  CreateScheduleEventDto,
  ScheduleVisitDto,
  UpdateScheduleEventDto,
  ListScheduleEventsParams,
} from '@quironequine/shared-types';
import { AppError, saoPauloDay, saoPauloDayRange } from '@quironequine/shared-middlewares';
import type {
  ScheduleEventRepository,
  ScheduleEventData,
  ScheduleEventPatch,
} from '../repositories/schedule-event.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FieldError = { field: string; message: string };

/** Data ISO → Date, ou erro de campo. */
function parseDate(value: string, field: string, errors: FieldError[]): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push({ field, message: 'Data inválida' });
    return null;
  }
  return date;
}

/** RF-AGD-004: antecedências sem repetição, em ordem crescente, dentro dos limites. */
export function normalizeReminders(minutes: number[], errors: FieldError[]): number[] {
  const unique = [...new Set(minutes)].sort((a, b) => a - b);
  if (unique.length > SCHEDULE_LIMITS.maxReminders) {
    errors.push({ field: 'reminderMinutesBefore', message: `No máximo ${SCHEDULE_LIMITS.maxReminders} lembretes` });
  }
  if (unique.some((m) => !Number.isInteger(m) || m < 0 || m > SCHEDULE_LIMITS.maxReminderMinutesBefore)) {
    errors.push({ field: 'reminderMinutesBefore', message: 'Lembrete deve ser de 0 minutos a 7 dias antes' });
  }
  return unique;
}

/**
 * Regras de um evento completo (criação, ou edição já somada ao que existe).
 * Proprietário e propriedade só podem faltar em `other` (RF-AGD-002).
 */
function checkEvent(event: ScheduleEventData, errors: FieldError[]): void {
  if (event.activityType !== 'other') {
    if (!event.ownerId) errors.push({ field: 'ownerId', message: 'Informe o proprietário' });
    if (!event.propertyId) errors.push({ field: 'propertyId', message: 'Informe a propriedade' });
  }
  if (event.endsAt && event.endsAt <= event.startsAt) {
    errors.push({ field: 'endsAt', message: 'O fim deve ser depois do início' });
  }
}

/**
 * Nenhum lembrete no passado: o instante de cada um (início − antecedência)
 * tem de ser agora ou depois. Evento passado pode existir (registrar uma
 * visita feita), mas sem lembrete.
 */
export function checkRemindersNotPast(startsAt: Date, minutes: number[], now: Date, errors: FieldError[]): void {
  if (minutes.some((m) => startsAt.getTime() - m * 60 * 1000 < now.getTime())) {
    errors.push({ field: 'reminderMinutesBefore', message: 'Lembrete cairia no passado' });
  }
}

function throwIfErrors(errors: FieldError[]): void {
  if (errors.length > 0) throw AppError.validation('Evento da agenda inválido', errors);
}

/** DTO de criação → dados do repositório, já validados. */
export function toEventData(
  activityType: ScheduleActivityType,
  dto: Omit<CreateScheduleEventDto, 'activityType'>,
  sourceAppointmentId: UUID | null,
  now: Date,
): ScheduleEventData {
  const errors: FieldError[] = [];
  const startsAt = parseDate(dto.startsAt, 'startsAt', errors);
  const endsAt = dto.endsAt ? parseDate(dto.endsAt, 'endsAt', errors) : null;
  const reminders = normalizeReminders(dto.reminderMinutesBefore ?? [], errors);
  throwIfErrors(errors);

  const data: ScheduleEventData = {
    activityType,
    startsAt: startsAt as Date,
    endsAt,
    ownerId: dto.ownerId ?? null,
    propertyId: dto.propertyId ?? null,
    animalIds: [...new Set(dto.animalIds ?? [])],
    notes: dto.notes?.trim() || null,
    reminderMinutesBefore: reminders,
    sourceAppointmentId,
  };
  checkEvent(data, errors);
  checkRemindersNotPast(data.startsAt, data.reminderMinutesBefore, now, errors);
  throwIfErrors(errors);
  return data;
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a IScheduleService publicada em shared-types (RF-AGD-001 a 004,
 * 006; RF-ATD-010; RN-011).
 */
export class ScheduleService implements IScheduleService {
  constructor(
    private readonly repo: ScheduleEventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** RF-AGD-001: visão mensal ou semanal. Intervalo limitado, sem paginação. */
  async list(ctx: RequestContext, params: ListScheduleEventsParams): Promise<ScheduleEvent[]> {
    const errors: FieldError[] = [];
    const from = parseDate(params.from, 'from', errors);
    const to = parseDate(params.to, 'to', errors);
    throwIfErrors(errors);
    if ((to as Date) <= (from as Date)) {
      throw AppError.validation('Intervalo inválido', [{ field: 'to', message: 'O fim deve ser depois do início' }]);
    }
    if ((to as Date).getTime() - (from as Date).getTime() > SCHEDULE_LIMITS.maxListDays * DAY_MS) {
      throw AppError.validation('Intervalo grande demais', [
        { field: 'to', message: `No máximo ${SCHEDULE_LIMITS.maxListDays} dias` },
      ]);
    }
    return this.repo.listRange(ctx, from as Date, to as Date, params.status);
  }

  /** RF-AGD-003 / RN-011: o dia de São Paulo, sem cancelados, em ordem de horário. */
  async listDay(ctx: RequestContext, day?: string): Promise<ScheduleEvent[]> {
    const target = day ?? saoPauloDay(this.now());
    if (!DAY_PATTERN.test(target) || Number.isNaN(Date.parse(`${target}T12:00:00Z`))) {
      throw AppError.validation('Dia inválido', [{ field: 'day', message: 'Use o formato AAAA-MM-DD' }]);
    }
    const { from, to } = saoPauloDayRange(target);
    return this.repo.listRange(ctx, from, to, ['scheduled', 'done']);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<ScheduleEvent | null> {
    return this.repo.findById(ctx, id);
  }

  async findReturn(ctx: RequestContext, appointmentId: UUID): Promise<ScheduleEvent | null> {
    return this.repo.findActiveReturn(ctx, appointmentId);
  }

  async create(ctx: RequestContext, data: CreateScheduleEventDto): Promise<ScheduleEvent> {
    const { activityType, ...rest } = data;
    return this.repo.create(ctx, toEventData(activityType, rest, null, this.now()));
  }

  /**
   * "Agendar visita": tela própria e retorno opcional do atendimento
   * (RF-ATD-010, RF-AGD-006). O atendimento de origem não é conferido no MS3
   * (sem chamada entre serviços, ADR-001 §5.1); o índice único parcial
   * garante um retorno ativo por atendimento.
   */
  async scheduleVisit(ctx: RequestContext, data: ScheduleVisitDto): Promise<ScheduleEvent> {
    const { sourceAppointmentId, ...rest } = data;
    return this.repo.create(ctx, toEventData('visit', rest, sourceAppointmentId ?? null, this.now()));
  }

  /** Só em `scheduled`. Valida o evento como ficará depois da edição. */
  async update(ctx: RequestContext, id: UUID, data: UpdateScheduleEventDto): Promise<ScheduleEvent> {
    const current = await this.repo.findById(ctx, id);
    if (!current) throw AppError.notFound('Evento da agenda não encontrado');
    if (current.status !== 'scheduled') throw AppError.conflict('Evento concluído ou cancelado não pode ser editado');

    const errors: FieldError[] = [];
    const patch: ScheduleEventPatch = {};
    if (data.startsAt !== undefined) {
      const startsAt = parseDate(data.startsAt, 'startsAt', errors);
      if (startsAt) patch.startsAt = startsAt;
    }
    if (data.endsAt !== undefined) patch.endsAt = data.endsAt ? parseDate(data.endsAt, 'endsAt', errors) : null;
    if (data.ownerId !== undefined) patch.ownerId = data.ownerId;
    if (data.propertyId !== undefined) patch.propertyId = data.propertyId;
    if (data.animalIds !== undefined) patch.animalIds = [...new Set(data.animalIds)];
    if (data.notes !== undefined) patch.notes = data.notes?.trim() || null;
    if (data.reminderMinutesBefore !== undefined) {
      patch.reminderMinutesBefore = normalizeReminders(data.reminderMinutesBefore, errors);
    }
    throwIfErrors(errors);

    const startsAt = patch.startsAt ?? new Date(current.startsAt);
    const reminders = patch.reminderMinutesBefore ?? current.reminderMinutesBefore;
    checkEvent(
      {
        activityType: current.activityType,
        startsAt,
        endsAt: patch.endsAt !== undefined ? patch.endsAt : current.endsAt ? new Date(current.endsAt) : null,
        ownerId: patch.ownerId !== undefined ? patch.ownerId : current.ownerId,
        propertyId: patch.propertyId !== undefined ? patch.propertyId : current.propertyId,
        animalIds: patch.animalIds ?? current.animalIds,
        notes: null,
        reminderMinutesBefore: reminders,
        sourceAppointmentId: current.sourceAppointmentId,
      },
      errors,
    );
    // Só quando horário ou lembretes mudam: corrigir a observação de um evento
    // cujo lembrete já disparou continua possível.
    if (patch.startsAt !== undefined || patch.reminderMinutesBefore !== undefined) {
      checkRemindersNotPast(startsAt, reminders, this.now(), errors);
    }
    throwIfErrors(errors);

    const updated = await this.repo.update(ctx, id, patch);
    // Concluído/cancelado entre a leitura e a gravação.
    if (!updated) throw AppError.conflict('Evento concluído ou cancelado não pode ser editado');
    return updated;
  }

  async complete(ctx: RequestContext, id: UUID): Promise<ScheduleEvent> {
    const done = await this.repo.complete(ctx, id, this.now());
    if (done) return done;
    throw await this.transitionError(ctx, id);
  }

  async cancel(ctx: RequestContext, id: UUID): Promise<ScheduleEvent> {
    const cancelled = await this.repo.cancel(ctx, id, this.now());
    if (cancelled) return cancelled;
    throw await this.transitionError(ctx, id);
  }

  async remove(ctx: RequestContext, id: UUID): Promise<void> {
    const removed = await this.repo.softDelete(ctx, id, this.now());
    if (!removed) throw AppError.notFound('Evento da agenda não encontrado');
  }

  /** Por que a transição não aconteceu: não existe (404) ou já saiu de `scheduled` (409). */
  private async transitionError(ctx: RequestContext, id: UUID): Promise<AppError> {
    const current = await this.repo.findById(ctx, id);
    if (!current) return AppError.notFound('Evento da agenda não encontrado');
    return AppError.conflict(
      current.status === 'done' ? 'Evento já foi concluído' : 'Evento já foi cancelado',
    );
  }
}
