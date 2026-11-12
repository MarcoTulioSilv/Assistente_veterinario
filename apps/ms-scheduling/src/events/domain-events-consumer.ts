import { Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { domainEventsQueueName } from './publisher';

const log = createServiceLogger('domain-events-consumer');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Plumbing BullMQ pura — o que fazer com o job vive em LastVisitService.handle(),
 * testável sem broker.
 *
 * A fila é a do scheduling (`domain-events-scheduling`, ADR-002) e recebe as
 * visitas feitas: `appointment.done` e `vaccination.applied`. O MS3 publica
 * uma cópia de cada um aqui, além das do inventory e do reporting.
 */
export function startDomainEventsWorker(handler: (job: Job) => Promise<void>): Worker {
  const worker = new Worker(domainEventsQueueName('scheduling'), handler, {
    connection,
    prefix,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, jobName: job?.name, err }, 'Job de última visita falhou');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, jobName: job.name }, 'Job de última visita concluído');
  });

  return worker;
}
