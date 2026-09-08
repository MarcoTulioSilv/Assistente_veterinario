import { createServiceLogger } from '@vetequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { alertQueue, scheduleAlertChecks, startAlertWorker } from './services/alert-scheduler';
import { AlertService } from './services/alert.service';
import { ProductRepository } from './repositories/product.repository';
import { AlertConfigRepository } from './repositories/alert-config.repository';
import { closeEventsQueue } from './events/publisher';

const log = createServiceLogger('ms-inventory');
const PORT = Number(process.env['PORT_MS_INVENTORY'] ?? 3002);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS2 Inventory iniciado');
});

const alertService = new AlertService(new ProductRepository(), new AlertConfigRepository());
const alertWorker = startAlertWorker(() => alertService.checkAllTenants());
void scheduleAlertChecks();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await alertWorker.close();
    await alertQueue.close();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
