import { createServiceLogger } from '@vetequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';

const log = createServiceLogger('ms-inventory');
const PORT = Number(process.env['PORT_MS_INVENTORY'] ?? 3002);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS2 Inventory iniciado');
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
