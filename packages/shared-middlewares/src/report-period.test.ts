import { describe, it, expect } from 'vitest';
import { parseReportPeriod } from './report-period';
import { AppError } from './errors';

describe('parseReportPeriod', () => {
  it('devolve as datas de um período válido', () => {
    expect(parseReportPeriod({ from: '2026-01-01T03:00:00Z', to: '2026-12-01T03:00:00Z' })).toEqual({
      from: new Date('2026-01-01T03:00:00Z'),
      to: new Date('2026-12-01T03:00:00Z'),
    });
  });

  it('recusa data inválida, fim antes do início e mais de 24 meses', () => {
    for (const period of [
      { from: 'ontem', to: '2026-12-01T03:00:00Z' },
      { from: '2026-12-01T03:00:00Z', to: '2026-01-01T03:00:00Z' },
      { from: '2026-01-01T03:00:00Z', to: '2026-01-01T03:00:00Z' },
      { from: '2024-01-01T03:00:00Z', to: '2026-06-01T03:00:00Z' },
    ]) {
      expect(() => parseReportPeriod(period)).toThrow(AppError);
    }
  });
});
