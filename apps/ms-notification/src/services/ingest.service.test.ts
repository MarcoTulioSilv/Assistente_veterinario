import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent, NotificationRecipient } from '@quironequine/shared-types';
import type { Channels, PushSender, EmailSender } from '../channels/channels';
import { IngestService, planFor, ALERT_FRESH_MS } from './ingest.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const VET = '33333333-3333-3333-3333-333333333333';
const ID = '44444444-4444-4444-4444-444444444444';
const KEY = '55555555-5555-5555-5555-555555555555';
const NOW = new Date('2026-12-01T13:00:00Z'); // 10h em São Paulo

function event(name: string, payload: Record<string, unknown>, occurredAt = NOW.toISOString()): DomainEvent<unknown> {
  return { name: name as DomainEvent['name'], tenantId: TENANT, traceId: 't', idempotencyKey: KEY, occurredAt, payload };
}

const reminder = (startsAt: string) =>
  event('schedule.reminder_due', {
    scheduleEventId: ID,
    activityType: 'visit',
    startsAt,
    minutesBefore: 60,
    ownerId: null,
    propertyId: null,
    recipientUserId: USER,
  });

const recipient = (userId: string): NotificationRecipient => ({ userId, email: 'v@x.com', phone: null, emailVerified: true });

const pushOn: Channels = { push: {} as PushSender, whatsapp: null, email: null };

function setup(opts: { channels?: Channels; created?: boolean; enabled?: boolean; vet?: NotificationRecipient | null; admins?: NotificationRecipient[] } = {}) {
  const deps = {
    notifications: { createIfAbsent: vi.fn().mockResolvedValue({ id: 'n1', created: opts.created ?? true }) },
    preferences: { isEnabled: vi.fn().mockResolvedValue(opts.enabled ?? true) },
    directory: {
      byUser: vi.fn(),
      byVeterinarian: vi.fn().mockResolvedValue(opts.vet === undefined ? recipient(USER) : opts.vet),
      tenantAdmins: vi.fn().mockResolvedValue(opts.admins ?? [recipient(USER), recipient('u2')]),
    },
    channels: opts.channels ?? pushOn,
    enqueue: vi.fn().mockResolvedValue(undefined),
    accountEmails: { handle: vi.fn().mockResolvedValue(undefined) },
    now: () => NOW,
  };
  return { deps, service: new IngestService(deps) };
}

describe('planFor', () => {
  it('lembrete da agenda vai para quem agendou; vencido se o evento já começou', () => {
    const fresh = planFor(reminder('2026-12-01T14:00:00Z'), NOW)!;
    expect(fresh.audience).toEqual({ userId: USER });
    expect(fresh.target).toEqual({ kind: 'schedule_event', id: ID });
    expect(fresh.stale).toBe(false);
    expect(planFor(reminder('2026-12-01T13:00:00Z'), NOW)!.stale).toBe(true);
  });

  it('resultado de exame e re-vacinação vão para o veterinário; vencidos se o dia já passou em São Paulo', () => {
    const exam = (expectedResultAt: string) =>
      event('exam.result_due', { examRequestId: ID, ownerId: ID, veterinarianId: VET, examTypeName: 'AIE', expectedResultAt, kind: 'due_today' });
    expect(planFor(exam('2026-12-01T20:00:00Z'), NOW)).toMatchObject({ audience: { veterinarianId: VET }, stale: false });
    // 02h UTC do dia 1 ainda é 30/11 em São Paulo: já passou.
    expect(planFor(exam('2026-12-01T02:00:00Z'), NOW)!.stale).toBe(true);

    const vac = planFor(
      event('vaccination.due', {
        vaccinationId: ID, ownerId: ID, propertyId: ID, veterinarianId: VET, vaccineName: 'Influenza',
        animalIds: [ID, KEY], nextDoseAt: '2026-11-20T12:00:00Z', kind: 'due_today',
      }),
      NOW,
    )!;
    expect(vac.data).toMatchObject({ type: 'vaccination_due', animalCount: 2 });
    expect(vac.stale).toBe(true);
  });

  it('alerta de estoque vai para os admins; validade e baixo estoque viram tipos próprios; velho de mais de 24 h é vencido', () => {
    const expiry = planFor(
      event('alert.triggered', { productId: ID, alertType: 'expiry', productName: 'Vacina X', expiryDate: '2026-12-10T00:00:00.000Z' }),
      NOW,
    )!;
    expect(expiry).toMatchObject({ audience: { tenantAdmins: true }, data: { type: 'stock_expiry', productName: 'Vacina X' }, stale: false });

    const low = planFor(
      event(
        'alert.triggered',
        { productId: ID, alertType: 'low_stock', productName: 'Seringa', quantityInStock: 2 },
        new Date(NOW.getTime() - ALERT_FRESH_MS - 1).toISOString(),
      ),
      NOW,
    )!;
    expect(low).toMatchObject({ data: { type: 'stock_low', quantityInStock: 2 }, stale: true });
  });

  it('payment.registered não vira aviso (nada vai ao proprietário)', () => {
    expect(planFor(event('payment.registered', {}), NOW)).toBeNull();
  });

  it('payload malformado falha', () => {
    expect(() => planFor(event('schedule.reminder_due', { scheduleEventId: 'x' }), NOW)).toThrow();
  });
});

describe('IngestService.handle', () => {
  it('grava a caixa de entrada e enfileira o push', async () => {
    const { service, deps } = setup();

    await service.handle('schedule.reminder_due', reminder('2026-12-01T14:00:00Z'));

    expect(deps.notifications.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, userId: USER, idempotencyKey: KEY }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith({ tenantId: TENANT, notificationId: 'n1', userId: USER, channel: 'push' });
  });

  it('lembrete vencido: só caixa de entrada', async () => {
    const { service, deps } = setup();
    await service.handle('schedule.reminder_due', reminder('2026-12-01T12:00:00Z'));
    expect(deps.notifications.createIfAbsent).toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('redelivery (item já existia) não entrega de novo', async () => {
    const { service, deps } = setup({ created: false });
    await service.handle('schedule.reminder_due', reminder('2026-12-01T14:00:00Z'));
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('canal desligado no servidor ou pelo usuário não é enfileirado', async () => {
    const off = setup({ channels: { push: null, whatsapp: null, email: null } });
    await off.service.handle('schedule.reminder_due', reminder('2026-12-01T14:00:00Z'));
    expect(off.deps.enqueue).not.toHaveBeenCalled();

    const optedOut = setup({ enabled: false });
    await optedOut.service.handle('schedule.reminder_due', reminder('2026-12-01T14:00:00Z'));
    expect(optedOut.deps.preferences.isEnabled).toHaveBeenCalledWith(TENANT, USER, 'schedule_reminder', 'push');
    expect(optedOut.deps.enqueue).not.toHaveBeenCalled();
  });

  it('alerta de estoque: um item por admin', async () => {
    const { service, deps } = setup({ channels: { push: null, whatsapp: null, email: {} as EmailSender } });
    await service.handle('alert.triggered', event('alert.triggered', { productId: ID, alertType: 'low_stock', productName: 'X' }));
    expect(deps.notifications.createIfAbsent).toHaveBeenCalledTimes(2);
    expect(deps.enqueue).toHaveBeenCalledTimes(2);
    expect(deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({ channel: 'email', userId: 'u2' }));
  });

  it('veterinário sem usuário ativo: descarta sem erro', async () => {
    const { service, deps } = setup({ vet: null });
    await service.handle(
      'exam.result_due',
      event('exam.result_due', { examRequestId: ID, ownerId: ID, veterinarianId: VET, examTypeName: 'AIE', expectedResultAt: '2026-12-02T12:00:00Z', kind: 'day_before' }),
    );
    expect(deps.notifications.createIfAbsent).not.toHaveBeenCalled();
  });

  it('payment.registered é descartado; e-mails da conta vão para o AccountEmailService', async () => {
    const { service, deps } = setup();
    await service.handle('payment.registered', event('payment.registered', {}));
    expect(deps.notifications.createIfAbsent).not.toHaveBeenCalled();

    const account = event('auth.password_reset_requested', {});
    await service.handle('auth.password_reset_requested', account);
    expect(deps.accountEmails.handle).toHaveBeenCalledWith('auth.password_reset_requested', account);
  });
});
