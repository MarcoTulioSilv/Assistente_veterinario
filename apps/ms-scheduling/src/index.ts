import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { ScheduleEventRepository } from './repositories/schedule-event.repository';
import { LastVisitRepository } from './repositories/last-visit.repository';
import { LastVisitService } from './services/last-visit.service';
import { ReminderService } from './services/reminder.service';
import { publishDomainEvent, closeEventsQueue } from './events/publisher';
import { startDomainEventsWorker } from './events/domain-events-consumer';
import { startReminderScan } from './events/reminder-scheduler';

const log = createServiceLogger('ms-scheduling');
const PORT = Number(process.env['PORT_MS_SCHEDULING'] ?? 3004);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS4 Scheduling iniciado');
});

// Visitas feitas (appointment.done, vaccination.applied) → última visita por propriedade.
const lastVisitService = new LastVisitService(new LastVisitRepository());
const domainEventsWorker = startDomainEventsWorker((job) =>
  lastVisitService.handle(job.name, job.data as DomainEvent<unknown>),
);

// Lembretes da agenda (RF-AGD-004), entregues pelo MS5.
const reminderService = new ReminderService(new ScheduleEventRepository(), publishDomainEvent);
const stopReminders = startReminderScan(() => reminderService.run()).catch((err: unknown) => {
  log.error({ err }, 'Não foi possível registrar a varredura de lembretes');
  return async () => {};
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await (await stopReminders)();
    await domainEventsWorker.close();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
