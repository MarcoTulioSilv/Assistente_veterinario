import { Queue } from 'bullmq';
import type { DomainEvent } from '@vetequine/shared-types';

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'vetequine';

/**
 * Fila genérica de domain events (ADR-001 §5.3/5.4) — primeiro
 * consumidor real é o DeductionService (events/deduction-consumer.ts,
 * appointment.done); alert.triggered ainda não tem consumidor (o
 * ms-notification não existe). Convenção provisória: não existe
 * ADR-002 (RabbitMQ vs Redis/BullMQ, prometida na ADR-001, nunca
 * escrita) formalizando isto — quando ela existir, esta fila/
 * convenção deve ser revista.
 * BullMQ proíbe ':' no nome da fila — o namespace é via `prefix`.
 */
export const DOMAIN_EVENTS_QUEUE_NAME = 'domain-events';

const eventsQueue = new Queue(DOMAIN_EVENTS_QUEUE_NAME, { connection, prefix });

export async function publishDomainEvent<T>(event: DomainEvent<T>): Promise<void> {
  await eventsQueue.add(event.name, event, {
    jobId: event.idempotencyKey,
    removeOnComplete: 500,
    removeOnFail: 1000,
    // Sem isto, zero retry por padrão — uma falha transiente (ex. banco
    // fora do ar por um instante) perderia a baixa de estoque pra
    // sempre em vez de tentar de novo. Idempotente do lado de quem
    // consome (ver DeductionService), então retry é seguro.
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function closeEventsQueue(): Promise<void> {
  await eventsQueue.close();
}
