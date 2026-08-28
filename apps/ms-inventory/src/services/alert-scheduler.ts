import { Queue, Worker, type Job } from 'bullmq';
import { createServiceLogger } from '@vetequine/shared-middlewares';

const log = createServiceLogger('alert-scheduler');

/**
 * Agendador de alertas de estoque — RN-009.
 *
 * Substitui o node-cron, que dependia de uuid < 11.1.1 (CVE).
 * O BullMQ ja esta no projeto para consumir eventos do broker e
 * tem job scheduler nativo com persistencia no Redis — se o
 * processo cair, o job nao se perde.
 */

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

// BullMQ proíbe ':' no nome da fila — o namespace entre serviços vem da
// opção `prefix`, não de concatenar string (bug que existia aqui antes:
// 'inventory:alerts' derrubava o processo assim que este módulo era
// importado, só ninguém tinha chamado scheduleAlertChecks()/
// startAlertWorker() ainda pra pegar isso).
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'vetequine';
const QUEUE_NAME = 'inventory-alerts';

export const alertQueue = new Queue(QUEUE_NAME, { connection, prefix });

/** Registra o job diario. Idempotente — pode rodar a cada boot. */
export async function scheduleAlertChecks(): Promise<void> {
  await alertQueue.upsertJobScheduler(
    'daily-expiry-check',
    { pattern: '0 6 * * *', tz: 'America/Sao_Paulo' },
    {
      name: 'check-expiry-and-low-stock',
      opts: { removeOnComplete: 50, removeOnFail: 100 },
    },
  );
  log.info('Job diario de alertas registrado (06h America/Sao_Paulo)');
}

/** Worker que processa o job */
export function startAlertWorker(
  handler: (job: Job) => Promise<void>,
): Worker {
  const worker = new Worker(QUEUE_NAME, handler, { connection, prefix, concurrency: 1 });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Job de alerta falhou');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Job de alerta concluido');
  });

  return worker;
}
