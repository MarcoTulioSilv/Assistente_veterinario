import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { closeEventsQueue } from './events/publisher';
import { startOutboxRelay } from './events/outbox-relay';
import { startExamReminders } from './events/exam-reminder-scheduler';
import { ExamReminderService } from './services/exam-reminder.service';
import { ExamRepository } from './repositories/exam.repository';

const log = createServiceLogger('ms-clinical');
const PORT = Number(process.env['PORT_MS_CLINICAL'] ?? 3003);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS3 Clinical iniciado');
});

// Drena o outbox continuamente (ADR-002). Sem isto o atendimento finaliza,
// grava o evento e ninguém nunca o publica — estoque não baixa e a
// pendência financeira não nasce.
const stopOutboxRelay = startOutboxRelay();

// Lembrete D-1/no dia pra buscar o resultado do exame. Falha ao agendar
// (Redis fora no boot) não derruba a API: o lembrete fica sem rodar até o
// próximo boot, e o log diz isso.
let stopExamReminders: (() => Promise<void>) | null = null;
startExamReminders(new ExamReminderService(new ExamRepository()))
  .then((stop) => {
    stopExamReminders = stop;
  })
  .catch((err: unknown) => log.error({ err }, 'Lembrete de exame não agendado'));

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    stopOutboxRelay();
    await stopExamReminders?.();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
