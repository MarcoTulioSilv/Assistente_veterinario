import { describe, it, expect, vi } from 'vitest';
import type { DueExamRow } from '../repositories/exam.repository';
import { ExamReminderService, reminderKind, saoPauloDay } from './exam-reminder.service';
import { deriveEventIdempotencyKey } from './billing';

// 07h de São Paulo (UTC-3) do dia 01/10/2026 — o horário do job.
const NOW = new Date('2026-10-01T10:00:00.000Z');

function row(id: string, expectedResultAt: string): DueExamRow {
  return {
    id,
    tenantId: '11111111-1111-1111-1111-111111111111',
    ownerId: '22222222-2222-2222-2222-222222222222',
    veterinarianId: '33333333-3333-3333-3333-333333333333',
    examTypeName: 'Mormo',
    expectedResultAt: new Date(expectedResultAt),
  };
}

describe('saoPauloDay', () => {
  it('usa o dia civil de São Paulo, não o do UTC', () => {
    // 01h UTC do dia 02 ainda é 22h do dia 01 em São Paulo.
    expect(saoPauloDay(new Date('2026-10-02T01:00:00.000Z'))).toBe('2026-10-01');
  });
});

describe('reminderKind', () => {
  it('data prevista hoje → due_today', () => {
    expect(reminderKind(new Date('2026-10-01T20:00:00.000Z'), NOW)).toBe('due_today');
  });

  it('data prevista amanhã → day_before', () => {
    expect(reminderKind(new Date('2026-10-02T15:00:00.000Z'), NOW)).toBe('day_before');
  });

  it('virada de dia: 01h UTC do dia 02 ainda é hoje em São Paulo', () => {
    expect(reminderKind(new Date('2026-10-02T01:00:00.000Z'), NOW)).toBe('due_today');
  });

  it('ontem ou depois de amanhã → nenhum', () => {
    expect(reminderKind(new Date('2026-09-30T15:00:00.000Z'), NOW)).toBeNull();
    expect(reminderKind(new Date('2026-10-03T15:00:00.000Z'), NOW)).toBeNull();
  });

  it('virada de mês', () => {
    expect(reminderKind(new Date('2026-11-01T15:00:00.000Z'), new Date('2026-10-31T10:00:00.000Z'))).toBe(
      'day_before',
    );
  });
});

describe('ExamReminderService.run', () => {
  it('publica só os pedidos de hoje e de amanhã, com chave por (pedido, tipo)', async () => {
    const repo = {
      listResultDueAcrossTenants: vi.fn().mockResolvedValue([
        row('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01T20:00:00.000Z'),
        row('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-02T15:00:00.000Z'),
        row('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-04T15:00:00.000Z'),
      ]),
    };
    const publish = vi.fn().mockResolvedValue(undefined);

    const published = await new ExamReminderService(repo, publish, () => NOW).run();

    expect(published).toBe(2);
    expect(publish.mock.calls.map(([event]) => [event.payload.examRequestId, event.payload.kind])).toEqual([
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'due_today'],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'day_before'],
    ]);
    expect(publish.mock.calls[0]?.[0].idempotencyKey).toBe(
      deriveEventIdempotencyKey('exam.result_due:due_today', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );
    expect(publish.mock.calls[0]?.[0].tenantId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('busca numa janela folgada em volta de agora', async () => {
    const repo = { listResultDueAcrossTenants: vi.fn().mockResolvedValue([]) };

    await new ExamReminderService(repo, vi.fn(), () => NOW).run();

    expect(repo.listResultDueAcrossTenants).toHaveBeenCalledWith(
      new Date('2026-09-29T10:00:00.000Z'),
      new Date('2026-10-04T10:00:00.000Z'),
    );
  });

  it('uma falha não segura os outros lembretes, mas falha o job', async () => {
    const repo = {
      listResultDueAcrossTenants: vi.fn().mockResolvedValue([
        row('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01T20:00:00.000Z'),
        row('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-01T21:00:00.000Z'),
      ]),
    };
    const publish = vi.fn().mockRejectedValueOnce(new Error('redis fora')).mockResolvedValue(undefined);

    await expect(new ExamReminderService(repo, publish, () => NOW).run()).rejects.toBeInstanceOf(AggregateError);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
