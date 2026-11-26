import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RequestContext } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { NotificationRepository } from '../repositories/notification.repository';
import type { PreferenceRepository } from '../repositories/preference.repository';
import type { PushSubscriptionRepository } from '../repositories/push-subscription.repository';
import { NotificationService, NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from './notification.service';
import { buildChannels } from '../channels/channels';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 't',
};
const NOW = new Date('2026-12-01T13:00:00Z');

function setup(overrides: { markRead?: boolean; saved?: Array<{ type: string; channel: string; enabled: boolean }> } = {}) {
  const notifications = {
    list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
    unreadCount: vi.fn().mockResolvedValue(3),
    markRead: vi.fn().mockResolvedValue(overrides.markRead ?? true),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  };
  const preferences = {
    listForUser: vi.fn().mockResolvedValue(overrides.saved ?? []),
    upsertMany: vi.fn().mockResolvedValue(undefined),
  };
  const subscriptions = { upsert: vi.fn(), revokeOwn: vi.fn() };
  const service = new NotificationService(
    notifications as unknown as NotificationRepository,
    preferences as unknown as PreferenceRepository,
    subscriptions as unknown as PushSubscriptionRepository,
    () => NOW,
  );
  return { service, notifications, preferences, subscriptions };
}

afterEach(() => {
  delete process.env['VAPID_PUBLIC_KEY'];
});

describe('NotificationService', () => {
  it('caixa de entrada: página e limite saneados (máximo 100)', async () => {
    const { service, notifications } = setup();
    await service.listInbox(ctx, { page: 0, limit: 500, unreadOnly: true });
    expect(notifications.list).toHaveBeenCalledWith(ctx, 1, 100, true);
    await service.listInbox(ctx, {});
    expect(notifications.list).toHaveBeenLastCalledWith(ctx, 1, 20, false);
    expect(await service.unreadCount(ctx)).toBe(3);
  });

  it('marcar como lida: 404 se não é do usuário', async () => {
    await expect(setup({ markRead: false }).service.markRead(ctx, 'x')).rejects.toBeInstanceOf(AppError);
    const { service, notifications } = setup();
    await service.markRead(ctx, 'x');
    await service.markAllRead(ctx);
    expect(notifications.markRead).toHaveBeenCalledWith(ctx, 'x', NOW);
    expect(notifications.markAllRead).toHaveBeenCalledWith(ctx, NOW);
  });

  it('preferências: toda combinação tipo × canal, ligada por padrão', async () => {
    const { service } = setup({ saved: [{ type: 'stock_low', channel: 'whatsapp', enabled: false }] });
    const prefs = await service.getPreferences(ctx);
    expect(prefs).toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
    expect(prefs.find((p) => p.type === 'stock_low' && p.channel === 'whatsapp')?.enabled).toBe(false);
    expect(prefs.filter((p) => !p.enabled)).toHaveLength(1);
  });

  it('atualizar preferências: recusa tipo desconhecido e grava a última escolha de cada combinação', async () => {
    const { service, preferences } = setup();
    await expect(
      service.updatePreferences(ctx, [{ type: 'x' as never, channel: 'push', enabled: false }]),
    ).rejects.toBeInstanceOf(AppError);

    await service.updatePreferences(ctx, [
      { type: 'stock_low', channel: 'push', enabled: false },
      { type: 'stock_low', channel: 'push', enabled: true },
    ]);
    expect(preferences.upsertMany).toHaveBeenCalledWith(ctx, [{ type: 'stock_low', channel: 'push', enabled: true }]);
  });

  it('push: endpoint precisa ser HTTPS; chave pública vem do ambiente', async () => {
    const { service, subscriptions } = setup();
    await expect(
      service.subscribePush(ctx, { endpoint: 'http://inseguro', keys: { p256dh: 'k', auth: 'a' } }),
    ).rejects.toBeInstanceOf(AppError);
    await service.subscribePush(ctx, { endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } });
    await service.unsubscribePush(ctx, 'https://push.example/x');
    expect(subscriptions.upsert).toHaveBeenCalled();
    expect(subscriptions.revokeOwn).toHaveBeenCalledWith(ctx, 'https://push.example/x', NOW);

    expect(service.getPushPublicKey()).toBe('');
    process.env['VAPID_PUBLIC_KEY'] = 'chave-publica';
    expect(service.getPushPublicKey()).toBe('chave-publica');
  });
});

describe('buildChannels', () => {
  const adapter = {} as never;

  it('push só com as duas chaves VAPID; WhatsApp e e-mail só com a chave ligada', () => {
    expect(buildChannels({ push: adapter, whatsapp: adapter, email: adapter }, {})).toEqual({ push: null, whatsapp: null, email: null });
    const on = buildChannels(
      { push: adapter, whatsapp: adapter, email: adapter },
      { VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', WHATSAPP_ENABLED: 'true', EMAIL_ENABLED: 'true' },
    );
    expect(on).toEqual({ push: adapter, whatsapp: adapter, email: adapter });
  });

  it('sem adapter, o canal fica desligado mesmo com a chave', () => {
    expect(buildChannels({}, { VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', EMAIL_ENABLED: 'true' })).toEqual({
      push: null,
      whatsapp: null,
      email: null,
    });
  });
});
