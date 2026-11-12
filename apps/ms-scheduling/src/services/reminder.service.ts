import { randomUUID } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent, ScheduleReminderDuePayload } from '@quironequine/shared-types';
import { deriveEventIdempotencyKey } from '@quironequine/shared-middlewares';
import type { ScheduleEventRepository, ReminderDueRow } from '../repositories/schedule-event.repository';

/**
 * Quanto para trás a varredura olha. O job roda a cada 5 min; a folga cobre
 * uma rodada perdida (deploy, Redis reiniciando) sem mandar lembrete muito
 * atrasado — evento criado depois da hora do lembrete não recebe aquele.
 */
export const REMINDER_LOOKBACK_MS = 15 * 60 * 1000;

export function buildReminderDueEvent(row: ReminderDueRow): DomainEvent<ScheduleReminderDuePayload> {
  return {
    name: EVENTS.SCHEDULE_REMINDER_DUE,
    tenantId: row.tenantId,
    traceId: `schedule-reminder-${randomUUID()}`,
    // De (evento, antecedência, início): rodar duas vezes não duplica, e
    // reagendar o evento gera um lembrete novo para o novo horário.
    idempotencyKey: deriveEventIdempotencyKey(
      `${EVENTS.SCHEDULE_REMINDER_DUE}:${row.minutesBefore}:${row.startsAt.toISOString()}`,
      row.id,
    ),
    occurredAt: new Date().toISOString(),
    payload: {
      scheduleEventId: row.id,
      activityType: row.activityType,
      startsAt: row.startsAt.toISOString(),
      minutesBefore: row.minutesBefore,
      ownerId: row.ownerId,
      propertyId: row.propertyId,
      recipientUserId: row.createdBy,
    },
  };
}

/**
 * RF-AGD-004: lembrete por horário. O MS4 só detecta e publica; quem entrega
 * é o MS5 (Sprint 10) — até lá, os eventos esperam na fila dele.
 *
 * Publica direto, sem outbox, como os lembretes do MS3: é varredura de
 * leitura. Se a publicação falhar, o job falha e o BullMQ tenta de novo; a
 * chave derivada evita duplicata.
 */
export class ReminderService {
  constructor(
    private readonly repo: Pick<ScheduleEventRepository, 'listRemindersDueAcrossTenants'>,
    private readonly publish: (event: DomainEvent<ScheduleReminderDuePayload>) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Devolve quantos lembretes publicou. */
  async run(): Promise<number> {
    const now = this.now();
    const rows = await this.repo.listRemindersDueAcrossTenants(new Date(now.getTime() - REMINDER_LOOKBACK_MS), now);

    const errors: unknown[] = [];
    let published = 0;
    for (const row of rows) {
      try {
        await this.publish(buildReminderDueEvent(row));
        published++;
      } catch (err) {
        // Um evento com problema não segura os lembretes dos outros.
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} lembrete(s) da agenda não publicado(s)`);
    }
    return published;
  }
}
