import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';

const log = createServiceLogger('ms-identity');
const PORT = Number(process.env['PORT_MS_IDENTITY'] ?? 3001);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS1 Identity & Registry iniciado');
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
