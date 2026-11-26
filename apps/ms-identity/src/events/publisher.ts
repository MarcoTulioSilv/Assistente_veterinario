import { Queue } from 'bullmq';
import { EVENT_SUBSCRIBERS } from '@quironequine/shared-types';
import type { DomainEvent, AccountEmailPayload } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('event-publisher');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Primeiro publisher do MS1 (Sprint 10): os e-mails da conta, que o MS5 envia
 * (ADR-007). Mesma convenção dos outros serviços — uma fila por consumidor,
 * fan-out pelo EVENT_SUBSCRIBERS (ADR-002).
 *
 * O payload leva o TOKEN cru (vai no link do e-mail). Por isso o job some do
 * Redis ao terminar, com sucesso ou não (`removeOnComplete`/`removeOnFail`), e
 * tenta poucas vezes: se o envio falhar de vez, o usuário pede outro link.
 *
 * Sem outbox: perder o evento só significa um e-mail que não chegou — o
 * token continua válido até vencer, e o reenvio existe.
 */
const queues = new Map<string, Queue>();

function queueFor(service: string): Queue {
  let queue = queues.get(service);
  if (!queue) {
    queue = new Queue(`domain-events-${service}`, { connection, prefix });
    queues.set(service, queue);
  }
  return queue;
}

export async function publishAccountEmail(event: DomainEvent<AccountEmailPayload>): Promise<void> {
  const subscribers = EVENT_SUBSCRIBERS[event.name];
  if (subscribers.length === 0) {
    log.warn({ event: event.name, traceId: event.traceId }, 'Evento sem assinante — descartado');
    return;
  }
  await Promise.all(
    subscribers.map((service) =>
      queueFor(service).add(event.name, event, {
        jobId: event.idempotencyKey,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    ),
  );
}

export async function closeEventsQueue(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
