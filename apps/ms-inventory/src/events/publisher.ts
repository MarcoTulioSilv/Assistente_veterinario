import { Queue } from 'bullmq';
import type { DomainEvent } from '@vetequine/shared-types';

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'vetequine';

/**
 * Fila genérica de domain events (ADR-001 §5.3/5.4) — sem consumidor
 * ainda (o ms-notification, que consumiria alert.triggered, não existe).
 * Convenção provisória: não existe ADR-002 (RabbitMQ vs Redis/BullMQ,
 * prometida na ADR-001, nunca escrita) formalizando isto — quando ela
 * existir, esta fila/convenção deve ser revista.
 * BullMQ proíbe ':' no nome da fila — o namespace é via `prefix`.
 */
const eventsQueue = new Queue('domain-events', { connection, prefix });

export async function publishDomainEvent<T>(event: DomainEvent<T>): Promise<void> {
  await eventsQueue.add(event.name, event, {
    jobId: event.idempotencyKey,
    removeOnComplete: 500,
    removeOnFail: 1000,
  });
}

export async function closeEventsQueue(): Promise<void> {
  await eventsQueue.close();
}
