import { Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { domainEventsQueueName } from './publisher';

const log = createServiceLogger('deduction-consumer');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';

/**
 * Plumbing BullMQ pura — sem lógica própria, tudo que decide o que
 * fazer com o job vive em DeductionService (testável sem broker). Só
 * um Worker: quem publica é publisher.ts, não precisamos de Queue aqui.
 *
 * A fila é a do ms-inventory (`domain-events-inventory`, ADR-002): o
 * publisher entrega uma cópia por serviço assinante, então nenhum outro
 * serviço compete com este worker pelos mesmos jobs. Ainda assim o
 * filtro por nome de evento continua dentro do handler — esta fila
 * recebe TODO evento que o inventory assina, não só appointment.done.
 */
export function startDeductionWorker(handler: (job: Job) => Promise<void>): Worker {
  // concurrency 5, não 1 (diferente do alert-scheduler.ts, que é cron
  // diário único): appointment.done pode chegar com frequência e
  // RN-003 pede baixa "automática e imediata".
  const worker = new Worker(domainEventsQueueName('inventory'), handler, { connection, prefix, concurrency: 5 });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, jobName: job?.name, err }, 'Job de baixa de estoque falhou');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, jobName: job.name }, 'Job de baixa de estoque concluído');
  });

  return worker;
}
