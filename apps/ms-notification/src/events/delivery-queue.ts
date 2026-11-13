import { Queue, Worker, type Job } from 'bullmq';
import type { NotificationChannel, UUID } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';

const log = createServiceLogger('delivery-queue');

const connection = {
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
};
const prefix = process.env['REDIS_QUEUE_PREFIX'] ?? 'quironequine';
const QUEUE_NAME = 'notification-deliveries';

/** Uma entrega = uma notificação por um canal. */
export interface DeliveryJob {
  tenantId: UUID;
  notificationId: UUID;
  userId: UUID;
  channel: NotificationChannel;
}

/**
 * Fila própria das entregas: uma por canal, separada do consumo do evento.
 * Se o push falhar, só ele tenta de novo — a caixa de entrada já foi
 * gravada, e os outros canais não reenviam.
 */
export function createDeliveryQueue(): { enqueue(job: DeliveryJob): Promise<void>; close(): Promise<void> } {
  const queue = new Queue(QUEUE_NAME, { connection, prefix });
  return {
    async enqueue(job) {
      await queue.add(job.channel, job, {
        // BullMQ não aceita ':' no jobId.
        jobId: `${job.notificationId}_${job.channel}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    },
    close: () => queue.close(),
  };
}

export function startDeliveryWorker(handler: (job: DeliveryJob) => Promise<void>): Worker {
  const worker = new Worker(QUEUE_NAME, (job: Job<DeliveryJob>) => handler(job.data), {
    connection,
    prefix,
    concurrency: 5,
  });
  worker.on('failed', (job, err) =>
    log.error({ jobId: job?.id, channel: job?.data.channel, err }, 'Entrega de notificação falhou'),
  );
  return worker;
}
