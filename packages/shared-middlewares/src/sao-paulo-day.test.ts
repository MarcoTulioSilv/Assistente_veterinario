import { describe, it, expect } from 'vitest';
import { saoPauloDay, addDays, saoPauloDayRange } from './sao-paulo-day';

describe('saoPauloDay', () => {
  it('usa o dia de São Paulo, não o de UTC', () => {
    // 01h UTC do dia 13 ainda é 22h do dia 12 em São Paulo.
    expect(saoPauloDay(new Date('2026-11-13T01:00:00Z'))).toBe('2026-11-12');
    expect(saoPauloDay(new Date('2026-11-13T03:00:00Z'))).toBe('2026-11-13');
  });
});

describe('addDays', () => {
  it('vira o mês e o ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('saoPauloDayRange', () => {
  it('vai da meia-noite à meia-noite de São Paulo (UTC−3)', () => {
    const { from, to } = saoPauloDayRange('2026-11-12');
    expect(from.toISOString()).toBe('2026-11-12T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-13T03:00:00.000Z');
  });

  it('um instante do dia cai dentro do intervalo e o da meia-noite seguinte, fora', () => {
    const { from, to } = saoPauloDayRange('2026-11-12');
    const lateNight = new Date('2026-11-13T02:59:59Z'); // 23:59:59 em São Paulo
    expect(lateNight >= from && lateNight < to).toBe(true);
    const nextMidnight = new Date('2026-11-13T03:00:00Z'); // 00:00 do dia 13 em São Paulo
    expect(nextMidnight < to).toBe(false);
  });
});
