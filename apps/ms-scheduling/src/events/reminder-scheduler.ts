import { Queue, Worker } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('reminder-scheduler');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

// BullMQ proíbe ':' no nome da fila — o namespace vem do `prefix`.
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';
const QUEUE_NAME = 'scheduling-reminders';
const JOB_NAME = 'schedule-reminders';
export const REMINDER_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Agenda a varredura de lembretes (RF-AGD-004) a cada 5 min e sobe o worker
 * que a executa. Mesmo padrão do reminder-scheduler do MS3: o job scheduler
 * do BullMQ persiste no Redis (sobrevive à queda do processo) e
 * `upsertJobScheduler` é idempotente — pode rodar a cada boot.
 *
 * Devolve a função de parada, para o shutdown gracioso.
 */
export async function startReminderScan(run: () => Promise<number>): Promise<() => Promise<void>> {
  const queue = new Queue(QUEUE_NAME, { connection, prefix });

  await queue.upsertJobScheduler(
    JOB_NAME,
    { every: REMINDER_INTERVAL_MS },
    { name: JOB_NAME, opts: { removeOnComplete: 50, removeOnFail: 100 } },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const published = await run();
      if (published > 0) log.info({ published }, 'Lembretes da agenda publicados');
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Varredura de lembretes falhou'));

  log.info({ everyMs: REMINDER_INTERVAL_MS }, 'Varredura de lembretes da agenda registrada');

  return async () => {
    await worker.close();
    await queue.close();
  };
}
