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
 * Uma fila por serviço consumidor (ADR-002) — mesma convenção do
 * ms-inventory. O broker é Redis/BullMQ, que não tem exchange: dois
 * workers na mesma fila competem por round-robin em vez de receberem
 * cópias. Como `appointment.done` tem dois destinos (ADR-001 §5.3:
 * Inventory baixa o estoque, Reporting abre a pendência), o fan-out é
 * responsabilidade de quem publica.
 *
 * Quem chama isto é o relay do outbox, nunca um service direto — ver
 * events/outbox.ts.
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
        // jobId é por fila no BullMQ: a mesma chave em duas filas não
        // colide, então cada consumidor mantém seu próprio dedup. É o
        // que torna seguro o relay republicar uma linha do outbox.
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
