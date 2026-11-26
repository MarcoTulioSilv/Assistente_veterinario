import { describe, it, expect, vi } from 'vitest';
import type { ReminderDueRow } from '../repositories/schedule-event.repository';
import { ReminderService, buildReminderDueEvent, REMINDER_LOOKBACK_MS } from './reminder.service';

const NOW = new Date('2026-11-12T13:00:00Z');

function row(overrides: Partial<ReminderDueRow> = {}): ReminderDueRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    tenantId: '11111111-1111-1111-1111-111111111111',
    activityType: 'visit',
    startsAt: new Date('2026-11-12T14:00:00Z'),
    minutesBefore: 60,
    ownerId: '44444444-4444-4444-4444-444444444444',
    propertyId: '55555555-5555-5555-5555-555555555555',
    createdBy: '22222222-2222-2222-2222-222222222222',
    ...overrides,
  };
}

describe('buildReminderDueEvent', () => {
  it('monta schedule.reminder_due para quem agendou, no tenant do evento', () => {
    const event = buildReminderDueEvent(row());

    expect(event.name).toBe('schedule.reminder_due');
    expect(event.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(event.payload).toEqual({
      scheduleEventId: '33333333-3333-3333-3333-333333333333',
      activityType: 'visit',
      startsAt: '2026-11-12T14:00:00.000Z',
      minutesBefore: 60,
      ownerId: '44444444-4444-4444-4444-444444444444',
      propertyId: '55555555-5555-5555-5555-555555555555',
      recipientUserId: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('a chave é estável para o mesmo lembrete e muda com a antecedência ou o horário', () => {
    const key = buildReminderDueEvent(row()).idempotencyKey;

    expect(buildReminderDueEvent(row()).idempotencyKey).toBe(key);
    expect(buildReminderDueEvent(row({ minutesBefore: 15 })).idempotencyKey).not.toBe(key);
    // Evento reagendado: lembrete novo para o novo horário.
    expect(buildReminderDueEvent(row({ startsAt: new Date('2026-11-12T15:00:00Z') })).idempotencyKey).not.toBe(key);
  });
});

describe('ReminderService.run', () => {
  it('varre a janela [agora − 15 min, agora) e publica um evento por lembrete', async () => {
    const listRemindersDueAcrossTenants = vi.fn().mockResolvedValue([row(), row({ minutesBefore: 15 })]);
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new ReminderService({ listRemindersDueAcrossTenants }, publish, () => NOW);

    const published = await service.run();

    expect(listRemindersDueAcrossTenants).toHaveBeenCalledWith(new Date(NOW.getTime() - REMINDER_LOOKBACK_MS), NOW);
    expect(published).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('uma falha não segura os outros lembretes, mas o job falha para o BullMQ tentar de novo', async () => {
    const publish = vi.fn().mockRejectedValueOnce(new Error('redis fora')).mockResolvedValue(undefined);
    const service = new ReminderService(
      { listRemindersDueAcrossTenants: vi.fn().mockResolvedValue([row(), row({ minutesBefore: 15 })]) },
      publish,
      () => NOW,
    );

    await expect(service.run()).rejects.toThrow('1 lembrete(s) da agenda não publicado(s)');
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
