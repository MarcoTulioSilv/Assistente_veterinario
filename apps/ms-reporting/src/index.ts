import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { FinancialRepository } from './repositories/financial.repository';
import { FinancialService } from './services/financial.service';
import { publishDomainEvent, closeEventsQueue } from './events/publisher';
import { startAppointmentDoneWorker } from './events/appointment-done-consumer';

const log = createServiceLogger('ms-reporting');
const PORT = Number(process.env['PORT_MS_REPORTING'] ?? 3006);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS6 Reporting iniciado (fatia financeira)');
});

const financialService = new FinancialService(new FinancialRepository(), publishDomainEvent);
const appointmentWorker = startAppointmentDoneWorker((job) =>
  financialService.handle(job.name, job.data as DomainEvent<unknown>),
);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await appointmentWorker.close();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
