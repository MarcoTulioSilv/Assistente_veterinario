import { randomUUID } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent, ExamResultDuePayload } from '@quironequine/shared-types';
import type { ExamRepository, DueExamRow } from '../repositories/exam.repository';
import { publishDomainEvent } from '../events/publisher';
import { deriveEventIdempotencyKey } from './billing';
import { saoPauloDay, addDays } from './sao-paulo-day';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Qual lembrete o pedido recebe hoje, se algum. */
export function reminderKind(expectedResultAt: Date, now: Date): ExamResultDuePayload['kind'] | null {
  const today = saoPauloDay(now);
  const due = saoPauloDay(expectedResultAt);
  if (due === today) return 'due_today';
  if (due === addDays(today, 1)) return 'day_before';
  return null;
}

export function buildExamResultDueEvent(
  row: DueExamRow,
  kind: ExamResultDuePayload['kind'],
): DomainEvent<ExamResultDuePayload> {
  return {
    name: EVENTS.EXAM_RESULT_DUE,
    tenantId: row.tenantId,
    traceId: `exam-reminder-${randomUUID()}`,
    // Derivada de (pedido, tipo de lembrete): o job rodar duas vezes no mesmo
    // dia não manda o lembrete duas vezes — o jobId repetido é descartado.
    idempotencyKey: deriveEventIdempotencyKey(`${EVENTS.EXAM_RESULT_DUE}:${kind}`, row.id),
    occurredAt: new Date().toISOString(),
    payload: {
      examRequestId: row.id,
      ownerId: row.ownerId,
      veterinarianId: row.veterinarianId,
      examTypeName: row.examTypeName,
      expectedResultAt: row.expectedResultAt.toISOString(),
      kind,
    },
  };
}

/**
 * Lembrete pra buscar o resultado: um dia antes e no dia da data prevista
 * (decisão do Marco). O MS3 só detecta e publica; quem entrega (push e
 * notificação) é o MS5 — até ele existir, os eventos esperam na fila dele.
 *
 * Publica direto, sem outbox, como o `alert.triggered` do MS2: é varredura
 * de leitura, não há commit com o qual ser atômico. Se a publicação falhar,
 * o job falha e o BullMQ tenta de novo; a chave derivada evita duplicata.
 */
export class ExamReminderService {
  constructor(
    private readonly repo: Pick<ExamRepository, 'listResultDueAcrossTenants'>,
    private readonly publish: (event: DomainEvent<ExamResultDuePayload>) => Promise<void> = publishDomainEvent,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Devolve quantos lembretes publicou. */
  async run(): Promise<number> {
    const now = this.now();
    // Janela folgada em volta de hoje/amanhã: a classificação exata é feita
    // aqui, no fuso de São Paulo, e não no SQL.
    const rows = await this.repo.listResultDueAcrossTenants(
      new Date(now.getTime() - 2 * DAY_MS),
      new Date(now.getTime() + 3 * DAY_MS),
    );

    const errors: unknown[] = [];
    let published = 0;
    for (const row of rows) {
      const kind = reminderKind(row.expectedResultAt, now);
      if (!kind) continue;
      try {
        await this.publish(buildExamResultDueEvent(row, kind));
        published++;
      } catch (err) {
        // Um pedido com problema não segura os lembretes dos outros.
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} lembrete(s) de exame não publicado(s)`);
    }
    return published;
  }
}
