import type { IRecipientDirectory, PushMessage } from '@quironequine/shared-types';
import { createServiceLogger, safeErrorMessage } from '@quironequine/shared-middlewares';
import type { NotificationRepository, DeliveryRow } from '../repositories/notification.repository';
import type { PushSubscriptionRepository } from '../repositories/push-subscription.repository';
import type { Channels } from '../channels/channels';
import type { DeliveryJob } from '../events/delivery-queue';

const log = createServiceLogger('delivery-service');

export interface DeliveryDeps {
  notifications: Pick<NotificationRepository, 'findForDelivery' | 'recordAttempt'>;
  subscriptions: Pick<PushSubscriptionRepository, 'listActive' | 'revokeGone'>;
  directory: Pick<IRecipientDirectory, 'byUser'>;
  channels: Channels;
  now?: () => Date;
}

/**
 * Lógica de negócio — Dev 1 é o dono. Entrega uma notificação por um canal
 * e registra o resultado em delivery_attempts (`sent`, `failed`, `skipped`).
 * Falha que vale tentar de novo vira exceção: o BullMQ refaz só este canal.
 */
export class DeliveryService {
  private readonly now: () => Date;

  constructor(private readonly deps: DeliveryDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async deliver(job: DeliveryJob): Promise<void> {
    const notification = await this.deps.notifications.findForDelivery(job.tenantId, job.notificationId);
    if (!notification) return; // excluída nesse meio-tempo

    switch (job.channel) {
      case 'push':
        return this.push(notification);
      case 'whatsapp':
        return this.whatsapp(notification);
      case 'email':
        return this.email(notification);
    }
  }

  private async push(n: DeliveryRow): Promise<void> {
    const sender = this.deps.channels.push;
    if (!sender) return this.record(n, 'push', 'skipped', 'canal desligado');

    const targets = await this.deps.subscriptions.listActive(n.tenantId, n.userId);
    if (targets.length === 0) return this.record(n, 'push', 'skipped', 'nenhum aparelho inscrito');

    const message: PushMessage = { notificationId: n.id, type: n.type, data: n.data, target: n.target };
    let sent = 0;
    let gone = 0;
    const errors: string[] = [];
    for (const target of targets) {
      try {
        if ((await sender.send(target, message)) === 'gone') {
          gone++;
          await this.deps.subscriptions.revokeGone(n.tenantId, target.id, this.now());
        } else {
          sent++;
        }
      } catch (err) {
        errors.push(safeErrorMessage(err));
      }
    }

    if (sent > 0) return this.record(n, 'push', 'sent', `${sent} aparelho(s)${errors.length ? `; ${errors.length} falha(s)` : ''}`);
    if (errors.length > 0) {
      await this.record(n, 'push', 'failed', errors[0] ?? null);
      // Nenhum aparelho recebeu: tentar de novo não duplica nada.
      throw new Error(`Push não entregue em nenhum aparelho (${errors.length} falha(s))`);
    }
    return this.record(n, 'push', 'skipped', `${gone} assinatura(s) vencida(s)`);
  }

  private async whatsapp(n: DeliveryRow): Promise<void> {
    const sender = this.deps.channels.whatsapp;
    if (!sender) return this.record(n, 'whatsapp', 'skipped', 'canal desligado');
    const recipient = await this.deps.directory.byUser(n.tenantId, n.userId);
    if (!recipient?.phone) return this.record(n, 'whatsapp', 'skipped', 'sem telefone');
    await this.send(n, 'whatsapp', () => sender.send(recipient.phone as string, n.data));
  }

  private async email(n: DeliveryRow): Promise<void> {
    const sender = this.deps.channels.email;
    if (!sender) return this.record(n, 'email', 'skipped', 'canal desligado');
    const recipient = await this.deps.directory.byUser(n.tenantId, n.userId);
    // Só para endereço confirmado (auditoria M-02).
    if (!recipient?.emailVerified) return this.record(n, 'email', 'skipped', 'e-mail não confirmado');
    await this.send(n, 'email', () => sender.sendNotification(recipient.email, n.data));
  }

  private async send(n: DeliveryRow, channel: 'whatsapp' | 'email', fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      await this.record(n, channel, 'failed', safeErrorMessage(err));
      throw err;
    }
    await this.record(n, channel, 'sent', null);
  }

  private async record(
    n: DeliveryRow,
    channel: DeliveryJob['channel'],
    status: 'sent' | 'failed' | 'skipped',
    detail: string | null,
  ): Promise<void> {
    await this.deps.notifications.recordAttempt(n.tenantId, n.id, channel, status, detail);
    log.info({ notificationId: n.id, channel, status }, 'Entrega registrada');
  }
}
