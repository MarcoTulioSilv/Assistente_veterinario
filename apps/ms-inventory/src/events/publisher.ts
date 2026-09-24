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
 * Uma fila por serviço consumidor (ADR-002). O broker é Redis/BullMQ, que
 * não tem exchange nem fan-out: dois workers na mesma fila COMPETEM por
 * round-robin, cada job indo pra um só deles. Como o ADR-001 §5.3 já prevê
 * `appointment.done` sendo consumido por Inventory E Reporting, uma fila
 * compartilhada entregaria cada evento a um dos dois — silenciosamente.
 *
 * Então o fan-out é do publisher: uma cópia do evento por assinante
 * (EVENT_SUBSCRIBERS, em shared-types, espelhando a tabela do §5.3).
 *
 * BullMQ proíbe ':' no nome da fila — daí o hífen; o namespace é o `prefix`.
 */
const DOMAIN_EVENTS_QUEUE_BASE = 'domain-events';

export function domainEventsQueueName(service: string): string {
  return `${DOMAIN_EVENTS_QUEUE_BASE}-${service}`;
}

/** Uma Queue por serviço, criada sob demanda e reaproveitada. */
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
        // colide, então cada consumidor mantém seu próprio dedup.
        jobId: event.idempotencyKey,
        removeOnComplete: 500,
        removeOnFail: 1000,
        // Sem isto, zero retry por padrão — uma falha transiente (ex. banco
        // fora do ar por um instante) perderia a baixa de estoque pra
        // sempre em vez de tentar de novo. Idempotente do lado de quem
        // consome (ver DeductionService), então retry é seguro.
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
