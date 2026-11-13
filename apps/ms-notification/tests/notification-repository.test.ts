/**
 * Integração do MS5 contra Postgres de verdade, com a role da aplicação.
 *
 * O que só um teste assim prova:
 *  - a UNIQUE torna o consumo idempotente (mesmo evento, mesmo usuário);
 *  - cada usuário só vê e marca a própria caixa de entrada; outro tenant, nada;
 *  - preferências e assinaturas de push gravam e atualizam como esperado;
 *  - o fluxo evento → caixa de entrada → entrega registra a tentativa.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext, DomainEvent } from '@quironequine/shared-types';
import { prisma } from '../src/prisma';
import { admin, purgeTenants } from './admin-db';
import { NotificationRepository } from '../src/repositories/notification.repository';
import { PreferenceRepository } from '../src/repositories/preference.repository';
import { PushSubscriptionRepository } from '../src/repositories/push-subscription.repository';
import { NotificationService } from '../src/services/notification.service';
import { IngestService } from '../src/services/ingest.service';
import { DeliveryService } from '../src/services/delivery.service';
import type { DeliveryJob } from '../src/events/delivery-queue';
import type { PushSender } from '../src/channels/channels';

const TENANT_A = 'e3000000-0000-0000-0000-000000000000';
const TENANT_B = 'e4000000-0000-0000-0000-000000000000';

function ctxFor(tenantId: string, userId = randomUUID()): RequestContext {
  return { tenantId, userId, role: 'admin', plan: 'basic', traceId: `trace-${randomUUID()}` };
}

const notifications = new NotificationRepository();
const preferences = new PreferenceRepository();
const subscriptions = new PushSubscriptionRepository();
const NOW = new Date('2026-12-01T13:00:00Z');
const service = new NotificationService(notifications, preferences, subscriptions, () => NOW);

function reminder(tenantId: string, userId: string, key = randomUUID()): DomainEvent<unknown> {
  return {
    name: 'schedule.reminder_due',
    tenantId,
    traceId: 't',
    idempotencyKey: key,
    occurredAt: NOW.toISOString(),
    payload: {
      scheduleEventId: randomUUID(),
      activityType: 'visit',
      startsAt: '2026-12-01T14:00:00.000Z',
      minutesBefore: 60,
      ownerId: null,
      propertyId: null,
      recipientUserId: userId,
    },
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  await purgeTenants(TENANT_A, TENANT_B);
});

afterAll(async () => {
  await admin.$disconnect();
  await prisma.$disconnect();
});

describe('evento → caixa de entrada → entrega', () => {
  it('o mesmo evento não gera dois itens nem duas entregas; a entrega registra a tentativa', async () => {
    const ctx = ctxFor(TENANT_A);
    const jobs: DeliveryJob[] = [];
    const send = vi.fn().mockResolvedValue('sent');
    const channels = { push: { send } as PushSender, whatsapp: null, email: null };
    const ingest = new IngestService({
      notifications,
      preferences,
      directory: { byUser: vi.fn(), byVeterinarian: vi.fn(), tenantAdmins: vi.fn() },
      channels,
      enqueue: async (job) => void jobs.push(job),
      accountEmails: { handle: vi.fn() },
      now: () => NOW,
    });
    const delivery = new DeliveryService({ notifications, subscriptions, directory: { byUser: vi.fn() }, channels, now: () => NOW });
    await service.subscribePush(ctx, { endpoint: 'https://push.example/aparelho', keys: { p256dh: 'k', auth: 'a' } });

    const event = reminder(TENANT_A, ctx.userId);
    await ingest.handle(event.name, event);
    await ingest.handle(event.name, event); // redelivery

    expect((await service.listInbox(ctx, {})).pagination.total).toBe(1);
    expect(jobs).toHaveLength(1);

    await delivery.deliver(jobs[0]!);
    expect(send).toHaveBeenCalledTimes(1);
    const attempts = await admin.deliveryAttempt.findMany({ where: { tenantId: TENANT_A } });
    expect(attempts.map((a) => [a.channel, a.status])).toEqual([['push', 'sent']]);
  });
});

describe('caixa de entrada', () => {
  it('cada usuário vê e marca só a própria; outro tenant não vê nada', async () => {
    const me = ctxFor(TENANT_A);
    const colleague = ctxFor(TENANT_A);
    const outsider = ctxFor(TENANT_B, me.userId);
    const mine = await notifications.createIfAbsent({
      tenantId: TENANT_A,
      userId: me.userId,
      data: { type: 'stock_low', productName: 'Seringa', quantityInStock: 2 },
      target: { kind: 'product', id: randomUUID() },
      idempotencyKey: randomUUID(),
    });

    const inbox = await service.listInbox(me, {});
    expect(inbox.data[0]).toMatchObject({
      type: 'stock_low',
      data: { type: 'stock_low', productName: 'Seringa', quantityInStock: 2 },
      readAt: null,
    });
    expect(await service.unreadCount(colleague)).toBe(0);
    expect(await service.unreadCount(outsider)).toBe(0);
    await expect(service.markRead(colleague, mine.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await service.markRead(me, mine.id);
    expect(await service.unreadCount(me)).toBe(0);
    expect((await service.listInbox(me, { unreadOnly: true })).data).toEqual([]);
  });
});

describe('preferências e push', () => {
  it('preferência desligada é lida pelo isEnabled; sem linha continua ligada', async () => {
    const ctx = ctxFor(TENANT_A);
    await service.updatePreferences(ctx, [{ type: 'stock_low', channel: 'push', enabled: false }]);

    expect(await preferences.isEnabled(TENANT_A, ctx.userId, 'stock_low', 'push')).toBe(false);
    expect(await preferences.isEnabled(TENANT_A, ctx.userId, 'stock_low', 'email')).toBe(true);
    expect(await preferences.isEnabled(TENANT_B, ctx.userId, 'stock_low', 'push')).toBe(true);
  });

  it('mesmo aparelho na mesma clínica passa para quem assinou por último; cancelar só a própria', async () => {
    const first = ctxFor(TENANT_A);
    const second = ctxFor(TENANT_A);
    const sub = { endpoint: 'https://push.example/compartilhado', keys: { p256dh: 'k', auth: 'a' } };

    await service.subscribePush(first, sub);
    await service.subscribePush(second, sub);
    expect(await subscriptions.listActive(TENANT_A, first.userId)).toEqual([]);
    expect(await subscriptions.listActive(TENANT_A, second.userId)).toHaveLength(1);

    await service.unsubscribePush(first, sub.endpoint); // não é mais dele: nada muda
    expect(await subscriptions.listActive(TENANT_A, second.userId)).toHaveLength(1);
    await service.unsubscribePush(second, sub.endpoint);
    expect(await subscriptions.listActive(TENANT_A, second.userId)).toEqual([]);
  });
});
