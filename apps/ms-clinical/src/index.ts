import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { closeEventsQueue } from './events/publisher';
import { startOutboxRelay } from './events/outbox-relay';
import { startDailyReminders } from './events/reminder-scheduler';
import { ExamReminderService } from './services/exam-reminder.service';
import { VaccinationReminderService } from './services/vaccination-reminder.service';
import { ExamRepository } from './repositories/exam.repository';
import { VaccinationRepository } from './repositories/vaccination.repository';

const log = createServiceLogger('ms-clinical');
const PORT = Number(process.env['PORT_MS_CLINICAL'] ?? 3003);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS3 Clinical iniciado');
});

// Drena o outbox continuamente (ADR-002). Sem isto o atendimento finaliza,
// grava o evento e ninguém nunca o publica — estoque não baixa e a
// pendência financeira não nasce.
const stopOutboxRelay = startOutboxRelay();

// Lembretes diários: resultado de exame (D-1 e no dia) e re-vacinação (7
// dias antes e no dia). Falha ao agendar (Redis fora no boot) não derruba a
// API: os lembretes ficam sem rodar até o próximo boot, e o log diz isso.
const examReminders = new ExamReminderService(new ExamRepository());
const vaccinationReminders = new VaccinationReminderService(new VaccinationRepository());
let stopReminders: (() => Promise<void>) | null = null;
startDailyReminders([
  { name: 'exam-result-due', run: (): Promise<number> => examReminders.run() },
  { name: 'vaccination-due', run: (): Promise<number> => vaccinationReminders.run() },
])
  .then((stop) => {
    stopReminders = stop;
  })
  .catch((err: unknown) => log.error({ err }, 'Lembretes diários não agendados'));

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    stopOutboxRelay();
    await stopReminders?.();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
