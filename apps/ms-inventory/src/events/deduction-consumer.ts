import { Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { DOMAIN_EVENTS_QUEUE_NAME } from './publisher';

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
 * `domain-events` é compartilhada — um Worker nela recebe QUALQUER
 * job, não só appointment.done (o filtro por nome fica dentro do
 * handler que é passado aqui). Se um SEGUNDO worker independente algum
 * dia escutar essa mesma fila (ex. um futuro consumidor de
 * alert.triggered), o BullMQ distribui os jobs entre os workers por
 * round-robin, não por broadcast — filtrar por nome aqui só protege
 * contra ESTE worker ocasionalmente receber um job de outro tipo, não
 * garante que cada tipo de evento sempre chegue ao worker certo.
 * Resolver isso de verdade exigiria fila por tipo de evento ou uma
 * camada de roteamento — fica registrado como mais um item da futura
 * ADR-002 (broker), mesma dívida já reconhecida em publisher.ts.
 */
export function startDeductionWorker(handler: (job: Job) => Promise<void>): Worker {
  // concurrency 5, não 1 (diferente do alert-scheduler.ts, que é cron
  // diário único): appointment.done pode chegar com frequência e
  // RN-003 pede baixa "automática e imediata".
  const worker = new Worker(DOMAIN_EVENTS_QUEUE_NAME, handler, { connection, prefix, concurrency: 5 });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, jobName: job?.name, err }, 'Job de baixa de estoque falhou');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, jobName: job.name }, 'Job de baixa de estoque concluído');
  });

  return worker;
}
