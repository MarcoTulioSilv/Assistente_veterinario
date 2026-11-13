import { describe, it, expect, vi } from 'vitest';
import type { NotificationRecipient } from '@quironequine/shared-types';
import type { Channels, PushSender, WhatsAppSender, EmailSender } from '../channels/channels';
import type { DeliveryRow } from '../repositories/notification.repository';
import type { DeliveryJob } from '../events/delivery-queue';
import { DeliveryService } from './delivery.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-12-01T13:00:00Z');

const row: DeliveryRow = {
  id: 'n1',
  tenantId: TENANT,
  userId: USER,
  type: 'stock_low',
  data: { type: 'stock_low', productName: 'Seringa', quantityInStock: 2 },
  target: { kind: 'product', id: '33333333-3333-3333-3333-333333333333' },
};

const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: 'k', auth: 'a' });
const job = (channel: DeliveryJob['channel']): DeliveryJob => ({ tenantId: TENANT, notificationId: 'n1', userId: USER, channel });

function setup(opts: { channels?: Partial<Channels>; subs?: ReturnType<typeof sub>[]; recipient?: NotificationRecipient | null; found?: DeliveryRow | null } = {}) {
  const deps = {
    notifications: {
      findForDelivery: vi.fn().mockResolvedValue(opts.found === undefined ? row : opts.found),
      recordAttempt: vi.fn().mockResolvedValue(undefined),
    },
    subscriptions: {
      listActive: vi.fn().mockResolvedValue(opts.subs ?? [sub('a')]),
      revokeGone: vi.fn().mockResolvedValue(undefined),
    },
    directory: {
      byUser: vi.fn().mockResolvedValue(
        opts.recipient === undefined ? { userId: USER, email: 'v@x.com', phone: '+5564999990000', emailVerified: true } : opts.recipient,
      ),
    },
    channels: { push: null, whatsapp: null, email: null, ...opts.channels } as Channels,
    now: () => NOW,
  };
  return { deps, service: new DeliveryService(deps) };
}

const lastAttempt = (deps: ReturnType<typeof setup>['deps']) => deps.notifications.recordAttempt.mock.calls.at(-1);

describe('DeliveryService — push', () => {
  it('manda para cada aparelho o tipo e os dados, sem texto', async () => {
    const send = vi.fn().mockResolvedValue('sent');
    const { service, deps } = setup({ channels: { push: { send } as PushSender }, subs: [sub('a'), sub('b')] });

    await service.deliver(job('push'));

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/a' }), {
      notificationId: 'n1',
      type: 'stock_low',
      data: row.data,
      target: row.target,
    });
    expect(lastAttempt(deps)).toEqual([TENANT, 'n1', 'push', 'sent', '2 aparelho(s)']);
  });

  it('assinatura que não existe mais (404/410) é revogada', async () => {
    const send = vi.fn().mockResolvedValueOnce('gone').mockResolvedValueOnce('sent');
    const { service, deps } = setup({ channels: { push: { send } as PushSender }, subs: [sub('a'), sub('b')] });

    await service.deliver(job('push'));

    expect(deps.subscriptions.revokeGone).toHaveBeenCalledWith(TENANT, 'a', NOW);
    expect(lastAttempt(deps)?.[3]).toBe('sent');
  });

  it('nenhum aparelho recebeu por erro: registra e falha para o BullMQ tentar de novo', async () => {
    const send = vi.fn().mockRejectedValue(new Error('timeout'));
    const { service, deps } = setup({ channels: { push: { send } as PushSender } });

    await expect(service.deliver(job('push'))).rejects.toThrow();
    expect(lastAttempt(deps)?.[3]).toBe('failed');
  });

  it('pulado: canal desligado, nenhum aparelho, todas as assinaturas vencidas', async () => {
    const off = setup();
    await off.service.deliver(job('push'));
    expect(lastAttempt(off.deps)).toEqual([TENANT, 'n1', 'push', 'skipped', 'canal desligado']);

    const none = setup({ channels: { push: { send: vi.fn() } as PushSender }, subs: [] });
    await none.service.deliver(job('push'));
    expect(lastAttempt(none.deps)?.[4]).toBe('nenhum aparelho inscrito');

    const gone = setup({ channels: { push: { send: vi.fn().mockResolvedValue('gone') } as PushSender } });
    await gone.service.deliver(job('push'));
    expect(lastAttempt(gone.deps)?.[3]).toBe('skipped');
  });

  it('notificação excluída nesse meio-tempo: nada a fazer', async () => {
    const { service, deps } = setup({ found: null });
    await service.deliver(job('push'));
    expect(deps.notifications.recordAttempt).not.toHaveBeenCalled();
  });
});

describe('DeliveryService — WhatsApp e e-mail', () => {
  it('WhatsApp para o telefone do veterinário', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { service, deps } = setup({ channels: { whatsapp: { send } as WhatsAppSender } });
    await service.deliver(job('whatsapp'));
    expect(send).toHaveBeenCalledWith('+5564999990000', row.data);
    expect(lastAttempt(deps)?.[3]).toBe('sent');
  });

  it('e-mail só para endereço confirmado', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const email = { sendNotification, sendAccountEmail: vi.fn() } as EmailSender;

    const ok = setup({ channels: { email } });
    await ok.service.deliver(job('email'));
    expect(sendNotification).toHaveBeenCalledWith('v@x.com', row.data);

    const unverified = setup({ channels: { email }, recipient: { userId: USER, email: 'v@x.com', phone: null, emailVerified: false } });
    await unverified.service.deliver(job('email'));
    expect(lastAttempt(unverified.deps)?.[4]).toBe('e-mail não confirmado');
  });

  it('pulado sem telefone ou com canal desligado; falha do envio é registrada e repetida', async () => {
    const noPhone = setup({ channels: { whatsapp: { send: vi.fn() } as WhatsAppSender }, recipient: null });
    await noPhone.service.deliver(job('whatsapp'));
    expect(lastAttempt(noPhone.deps)?.[4]).toBe('sem telefone');

    for (const channel of ['whatsapp', 'email'] as const) {
      const off = setup();
      await off.service.deliver(job(channel));
      expect(lastAttempt(off.deps)?.[4]).toBe('canal desligado');
    }

    const failing = setup({ channels: { whatsapp: { send: vi.fn().mockRejectedValue(new Error('meta fora')) } as WhatsAppSender } });
    await expect(failing.service.deliver(job('whatsapp'))).rejects.toThrow('meta fora');
    expect(lastAttempt(failing.deps)?.[3]).toBe('failed');
  });
});
