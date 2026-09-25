import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { closeEventsQueue } from './events/publisher';
import { startOutboxRelay } from './events/outbox-relay';

const log = createServiceLogger('ms-clinical');
const PORT = Number(process.env['PORT_MS_CLINICAL'] ?? 3003);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS3 Clinical iniciado');
});

// Drena o outbox continuamente (ADR-002). Sem isto o atendimento finaliza,
// grava o evento e ninguém nunca o publica — estoque não baixa e a
// pendência financeira não nasce.
const stopOutboxRelay = startOutboxRelay();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    stopOutboxRelay();
    await closeEventsQueue();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
