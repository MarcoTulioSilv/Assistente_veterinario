import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { createApp } from './app';
import { disconnectPrisma } from './prisma';
import { NotificationRepository } from './repositories/notification.repository';
import { PreferenceRepository } from './repositories/preference.repository';
import { PushSubscriptionRepository } from './repositories/push-subscription.repository';
import { IdentityDirectoryClient } from './clients/identity-directory.client';
import { buildChannels } from './channels/channels';
import { IngestService } from './services/ingest.service';
import { DeliveryService } from './services/delivery.service';
import { AccountEmailService } from './services/account-email.service';
import { startDomainEventsWorker } from './events/domain-events-consumer';
import { createDeliveryQueue, startDeliveryWorker } from './events/delivery-queue';

const log = createServiceLogger('ms-notification');
const PORT = Number(process.env['PORT_MS_NOTIFICATION'] ?? 3005);

const server = createApp().listen(PORT, () => {
  log.info({ port: PORT }, 'MS5 Notification iniciado');
});

// Adapters reais (Web Push, WhatsApp, e-mail) são do Dev 2 e entram aqui.
// Sem adapter, o canal fica desligado; a caixa de entrada funciona sempre.
const channels = buildChannels({});
log.info(
  { push: channels.push !== null, whatsapp: channels.whatsapp !== null, email: channels.email !== null },
  'Canais de entrega',
);

const notifications = new NotificationRepository();
const directory = new IdentityDirectoryClient();
const deliveries = createDeliveryQueue();

const ingest = new IngestService({
  notifications,
  preferences: new PreferenceRepository(),
  directory,
  channels,
  enqueue: (job) => deliveries.enqueue(job),
  accountEmails: new AccountEmailService(channels.email),
});
const delivery = new DeliveryService({
  notifications,
  subscriptions: new PushSubscriptionRepository(),
  directory,
  channels,
});

const domainEventsWorker = startDomainEventsWorker((job) => ingest.handle(job.name, job.data as DomainEvent<unknown>));
const deliveryWorker = startDeliveryWorker((job) => delivery.deliver(job));

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Encerrando graciosamente...');
  server.close(async () => {
    await domainEventsWorker.close();
    await deliveryWorker.close();
    await deliveries.close();
    await disconnectPrisma();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
