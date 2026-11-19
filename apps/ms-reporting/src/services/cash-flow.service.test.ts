import { describe, it, expect, vi } from 'vitest';
import type { RequestContext } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ReportRepository } from '../repositories/report.repository';
import { CashFlowService, DashboardService, TOP_OWNERS } from './cash-flow.service';

const plus: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 't',
};
const basic: RequestContext = { ...plus, plan: 'basic' };
const PERIOD = { from: '2026-09-01T03:00:00Z', to: '2026-12-01T03:00:00Z' };

function repo() {
  return {
    monthlyTotals: vi.fn().mockResolvedValue([
      { month: '2026-09', inflowCents: 50000, outflowCents: 20000 },
      { month: '2026-10', inflowCents: 0, outflowCents: 15000 },
      { month: '2026-11', inflowCents: 70000, outflowCents: 0 },
    ]),
    outflowByCategory: vi.fn().mockResolvedValue([{ category: 'fuel', amountCents: 35000 }]),
    topOwnersByReceived: vi.fn().mockResolvedValue([{ ownerId: 'o1', amountCents: 120000, payments: 3 }]),
  };
}

describe('CashFlowService (RF-REL-001)', () => {
  it('soma entradas e saídas, com o saldo de cada mês e do período', async () => {
    const r = repo();
    const summary = await new CashFlowService(r as unknown as ReportRepository).summary(plus, PERIOD);

    expect(summary).toEqual({
      inflowCents: 120000,
      outflowCents: 35000,
      balanceCents: 85000,
      months: [
        { month: '2026-09', inflowCents: 50000, outflowCents: 20000, balanceCents: 30000 },
        { month: '2026-10', inflowCents: 0, outflowCents: 15000, balanceCents: -15000 },
        { month: '2026-11', inflowCents: 70000, outflowCents: 0, balanceCents: 70000 },
      ],
      outflowByCategory: [{ category: 'fuel', amountCents: 35000 }],
    });
    expect(r.monthlyTotals).toHaveBeenCalledWith(plus, new Date(PERIOD.from), new Date(PERIOD.to));
  });

  it('só no Plus, e com período válido', async () => {
    const service = new CashFlowService(repo() as unknown as ReportRepository);
    await expect(service.summary(basic, PERIOD)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.summary(plus, { from: PERIOD.to, to: PERIOD.from })).rejects.toBeInstanceOf(AppError);
  });
});

describe('DashboardService (RF-REL-005)', () => {
  it('receita mensal pelas entradas e os maiores proprietários do período', async () => {
    const r = repo();
    const summary = await new DashboardService(r as unknown as ReportRepository).summary(plus, PERIOD);

    expect(summary.monthlyRevenue).toEqual([
      { month: '2026-09', amountCents: 50000 },
      { month: '2026-10', amountCents: 0 },
      { month: '2026-11', amountCents: 70000 },
    ]);
    expect(summary.topOwners).toEqual([{ ownerId: 'o1', amountCents: 120000, payments: 3 }]);
    expect(r.topOwnersByReceived).toHaveBeenCalledWith(plus, new Date(PERIOD.from), new Date(PERIOD.to), TOP_OWNERS);
  });

  it('só no Plus', async () => {
    await expect(new DashboardService(repo() as unknown as ReportRepository).summary(basic, PERIOD)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
