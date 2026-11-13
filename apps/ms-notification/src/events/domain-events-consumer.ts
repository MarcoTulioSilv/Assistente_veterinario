import { Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('domain-events-consumer');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Plumbing BullMQ pura — o que fazer com cada evento vive em
 * IngestService.handle(), testável sem broker.
 *
 * A fila `domain-events-notification` (ADR-002) acumula desde o M2: no
 * primeiro boot o MS5 recebe os avisos guardados. Os vencidos viram só item
 * da caixa de entrada, sem push (IngestService).
 */
export function startDomainEventsWorker(handler: (job: Job) => Promise<void>): Worker {
  const worker = new Worker('domain-events-notification', handler, {
    connection,
    prefix,
    concurrency: 5,
  });
  // Sem o payload no log: o e-mail da conta leva o token.
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, jobName: job?.name, err }, 'Evento de notificação falhou'));
  return worker;
}
