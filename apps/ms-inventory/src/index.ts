import type { DomainEvent } from '@vetequine/shared-types';
import { createServiceLogger } from '@vetequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { alertQueue, scheduleAlertChecks, startAlertWorker } from './services/alert-scheduler';
import { AlertService } from './services/alert.service';
import { StockService } from './services/stock.service';
import { DeductionService } from './services/deduction.service';
import { ProductRepository } from './repositories/product.repository';
import { MovementRepository } from './repositories/movement.repository';
import { AlertConfigRepository } from './repositories/alert-config.repository';
import { closeEventsQueue } from './events/publisher';
import { startDeductionWorker } from './events/deduction-consumer';

const log = createServiceLogger('ms-inventory');
const PORT = Number(process.env['PORT_MS_INVENTORY'] ?? 3002);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS2 Inventory iniciado');
});

const alertService = new AlertService(new ProductRepository(), new AlertConfigRepository());
const alertWorker = startAlertWorker(() => alertService.checkAllTenants());
void scheduleAlertChecks();

const stockService = new StockService(new ProductRepository(), new MovementRepository());
const deductionService = new DeductionService(stockService);
const deductionWorker = startDeductionWorker((job) =>
  deductionService.handle(job.name, job.data as DomainEvent<unknown>),
);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await alertWorker.close();
    await alertQueue.close();
    await deductionWorker.close();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
