import { Queue, Worker } from 'bullmq';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { ExamReminderService } from '../services/exam-reminder.service';

const log = createServiceLogger('exam-reminder-scheduler');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};

// BullMQ proíbe ':' no nome da fila — o namespace vem do `prefix`
// (mesmo padrão do alert-scheduler do MS2).
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';
const QUEUE_NAME = 'clinical-exam-reminders';

/**
 * Agenda a varredura diária de lembretes de exame (07h de São Paulo) e sobe
 * o worker que a executa. O job scheduler do BullMQ persiste no Redis: se o
 * processo cair, o agendamento não se perde, e `upsertJobScheduler` é
 * idempotente — pode rodar a cada boot.
 *
 * Devolve a função de parada, pro shutdown gracioso.
 */
export async function startExamReminders(service: ExamReminderService): Promise<() => Promise<void>> {
  const queue = new Queue(QUEUE_NAME, { connection, prefix });
  await queue.upsertJobScheduler(
    'daily-exam-result-due',
    { pattern: '0 7 * * *', tz: 'America/Sao_Paulo' },
    { name: 'check-exam-result-due', opts: { removeOnComplete: 50, removeOnFail: 100 } },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const published = await service.run();
      log.info({ published }, 'Lembretes de resultado de exame publicados');
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Job de lembrete de exame falhou'));

  log.info('Job diário de lembrete de exame registrado (07h America/Sao_Paulo)');

  return async () => {
    await worker.close();
    await queue.close();
  };
}
