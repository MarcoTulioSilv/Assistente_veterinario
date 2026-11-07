import { Queue } from 'bullmq';
import { EVENT_SUBSCRIBERS } from '@quironequine/shared-types';
import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('event-publisher');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Uma fila por serviço consumidor (ADR-002) — mesma convenção do MS2 e do
 * MS3. O fan-out é do publisher porque o Redis/BullMQ não tem exchange.
 *
 * Diferente do MS3, aqui NÃO há outbox. O único evento publicado é
 * `payment.registered`, e perdê-lo não quebra invariante de negócio: o
 * registro financeiro já está correto no banco, o que se perde é a
 * notificação ao proprietário (ADR-001 §5.3, consumidor é o MS5). O
 * critério do ADR-001 §6.2 é "eventos críticos" — quando a notificação
 * virar exigência (recibo legal, por exemplo), revisar.
 */
const DOMAIN_EVENTS_QUEUE_BASE = 'domain-events';

export function domainEventsQueueName(service: string): string {
  return `${DOMAIN_EVENTS_QUEUE_BASE}-${service}`;
}

const queues = new Map<string, Queue>();

function queueFor(service: string): Queue {
  let queue = queues.get(service);
  if (!queue) {
    queue = new Queue(domainEventsQueueName(service), { connection, prefix });
    queues.set(service, queue);
  }
  return queue;
}

export async function publishDomainEvent<T>(event: DomainEvent<T>): Promise<void> {
  const subscribers = EVENT_SUBSCRIBERS[event.name];

  if (subscribers.length === 0) {
    log.warn(
      { event: event.name, traceId: event.traceId },
      'Evento publicado sem assinante em EVENT_SUBSCRIBERS — descartado',
    );
    return;
  }

  await Promise.all(
    subscribers.map((service) =>
      queueFor(service).add(event.name, event, {
        jobId: event.idempotencyKey,
        removeOnComplete: 500,
        removeOnFail: 1000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    ),
  );
}

export async function closeEventsQueue(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
