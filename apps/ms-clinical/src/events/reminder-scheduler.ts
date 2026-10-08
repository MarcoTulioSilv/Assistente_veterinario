import { Queue, Worker } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('reminder-scheduler');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

// BullMQ proíbe ':' no nome da fila — o namespace vem do `prefix`
// (mesmo padrão do alert-scheduler do MS2).
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';
const QUEUE_NAME = 'clinical-reminders';

/** Um lembrete diário do MS3: resultado de exame, re-vacinação… */
export interface DailyReminder {
  /** Nome do job — identifica o lembrete no Redis e nos logs. */
  name: string;
  /** Devolve quantos lembretes publicou. */
  run(): Promise<number>;
}

/**
 * Agenda os lembretes diários (07h de São Paulo) numa fila só e sobe o
 * worker que os executa. O job scheduler do BullMQ persiste no Redis: se o
 * processo cair, o agendamento não se perde, e `upsertJobScheduler` é
 * idempotente — pode rodar a cada boot.
 *
 * Devolve a função de parada, pro shutdown gracioso.
 */
export async function startDailyReminders(reminders: DailyReminder[]): Promise<() => Promise<void>> {
  const byName = new Map(reminders.map((reminder) => [reminder.name, reminder]));
  const queue = new Queue(QUEUE_NAME, { connection, prefix });

  for (const reminder of reminders) {
    await queue.upsertJobScheduler(
      `daily-${reminder.name}`,
      { pattern: '0 7 * * *', tz: 'America/Sao_Paulo' },
      { name: reminder.name, opts: { removeOnComplete: 50, removeOnFail: 100 } },
    );
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const reminder = byName.get(job.name);
      if (!reminder) {
        log.warn({ jobName: job.name }, 'Job de lembrete sem handler — ignorado');
        return;
      }
      const published = await reminder.run();
      log.info({ reminder: job.name, published }, 'Lembretes publicados');
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, jobName: job?.name, err }, 'Job de lembrete falhou'));

  log.info({ reminders: [...byName.keys()] }, 'Lembretes diários registrados (07h America/Sao_Paulo)');

  return async () => {
    await worker.close();
    await queue.close();
  };
}
