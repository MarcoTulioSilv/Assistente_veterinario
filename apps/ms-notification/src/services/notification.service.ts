import type {
  INotificationService,
  RequestContext,
  UUID,
  Notification,
  NotificationPreference,
  NotificationType,
  NotificationChannel,
  PaginationParams,
  Paginated,
  PushSubscriptionDto,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { NotificationRepository } from '../repositories/notification.repository';
import type { PreferenceRepository } from '../repositories/preference.repository';
import type { PushSubscriptionRepository } from '../repositories/push-subscription.repository';
import { vapidPublicKey } from '../channels/channels';

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'schedule_reminder',
  'exam_result_due',
  'vaccination_due',
  'stock_expiry',
  'stock_low',
  'geofence',
];
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['push', 'whatsapp', 'email'];

const MAX_PAGE_SIZE = 100;

/**
 * Lógica de negócio — Dev 1 é o dono. Implementa a INotificationService
 * (RF-NOT-001 e 003): caixa de entrada, preferências e assinatura de push.
 * Tudo do próprio usuário logado.
 */
export class NotificationService implements INotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: PreferenceRepository,
    private readonly subscriptions: PushSubscriptionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listInbox(ctx: RequestContext, params: PaginationParams & { unreadOnly?: boolean }): Promise<Paginated<Notification>> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? 20));
    return this.notifications.list(ctx, page, limit, params.unreadOnly ?? false);
  }

  unreadCount(ctx: RequestContext): Promise<number> {
    return this.notifications.unreadCount(ctx);
  }

  async markRead(ctx: RequestContext, id: UUID): Promise<void> {
    if (!(await this.notifications.markRead(ctx, id, this.now()))) throw AppError.notFound('Notificação não encontrada');
  }

  markAllRead(ctx: RequestContext): Promise<void> {
    return this.notifications.markAllRead(ctx, this.now());
  }

  /** Toda combinação tipo × canal, com o padrão (ligado) onde não há escolha gravada. */
  async getPreferences(ctx: RequestContext): Promise<NotificationPreference[]> {
    const saved = await this.preferences.listForUser(ctx.tenantId, ctx.userId);
    const byKey = new Map(saved.map((p) => [`${p.type}:${p.channel}`, p.enabled]));
    return NOTIFICATION_TYPES.flatMap((type) =>
      NOTIFICATION_CHANNELS.map((channel) => ({ type, channel, enabled: byKey.get(`${type}:${channel}`) ?? true })),
    );
  }

  async updatePreferences(ctx: RequestContext, preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
    const unknown = preferences.filter(
      (p) => !NOTIFICATION_TYPES.includes(p.type) || !NOTIFICATION_CHANNELS.includes(p.channel),
    );
    if (unknown.length > 0) {
      throw AppError.validation('Preferência inválida', [{ field: 'preferences', message: 'Tipo ou canal desconhecido' }]);
    }
    // A última escolha de cada combinação vale.
    const unique = [...new Map(preferences.map((p) => [`${p.type}:${p.channel}`, p])).values()];
    await this.preferences.upsertMany(ctx, unique);
    return this.getPreferences(ctx);
  }

  getPushPublicKey(): string {
    return vapidPublicKey();
  }

  async subscribePush(ctx: RequestContext, subscription: PushSubscriptionDto): Promise<void> {
    if (!subscription.endpoint.startsWith('https://')) {
      throw AppError.validation('Assinatura de push inválida', [{ field: 'endpoint', message: 'O endpoint deve ser HTTPS' }]);
    }
    await this.subscriptions.upsert(ctx, subscription);
  }

  unsubscribePush(ctx: RequestContext, endpoint: string): Promise<void> {
    return this.subscriptions.revokeOwn(ctx, endpoint, this.now());
  }
}
