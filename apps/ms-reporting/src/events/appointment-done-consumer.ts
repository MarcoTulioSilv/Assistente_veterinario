import { Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { domainEventsQueueName } from './publisher';

const log = createServiceLogger('appointment-done-consumer');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Plumbing BullMQ pura — o que decide o que fazer com o job vive em
 * FinancialService.handle(), testável sem broker.
 *
 * A fila é a do reporting (`domain-events-reporting`, ADR-002). O MS3
 * publica uma cópia do `appointment.done` aqui e outra na fila do
 * inventory: os dois consumidores recebem o evento, em vez de disputá-lo.
 */
export function startAppointmentDoneWorker(handler: (job: Job) => Promise<void>): Worker {
  const worker = new Worker(domainEventsQueueName('reporting'), handler, {
    connection,
    prefix,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, jobName: job?.name, err }, 'Job de pendência financeira falhou');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, jobName: job.name }, 'Job de pendência financeira concluído');
  });

  return worker;
}
