import type {
  ICashFlowService,
  IDashboardService,
  RequestContext,
  ReportPeriod,
  CashFlowSummary,
  DashboardSummary,
} from '@quironequine/shared-types';
import { parseReportPeriod } from '@quironequine/shared-middlewares';
import type { ReportRepository } from '../repositories/report.repository';
import { assertPlus } from './plus-only';

/** Quantos proprietários o dashboard mostra (RF-REL-005). */
export const TOP_OWNERS = 10;

/**
 * Lógica de negócio — Dev 1 é o dono. RF-REL-001: fluxo de caixa do
 * período. Entradas = pagamentos recebidos (data do pagamento); saídas =
 * saídas avulsas e compras de estoque (dia informado). Só no Plano Plus.
 */
export class CashFlowService implements ICashFlowService {
  constructor(private readonly repo: ReportRepository) {}

  async summary(ctx: RequestContext, period: ReportPeriod): Promise<CashFlowSummary> {
    assertPlus(ctx);
    const { from, to } = parseReportPeriod(period);
    const [totals, outflowByCategory] = await Promise.all([
      this.repo.monthlyTotals(ctx, from, to),
      this.repo.outflowByCategory(ctx, from, to),
    ]);

    const months = totals.map((m) => ({ ...m, balanceCents: m.inflowCents - m.outflowCents }));
    const inflowCents = months.reduce((sum, m) => sum + m.inflowCents, 0);
    const outflowCents = months.reduce((sum, m) => sum + m.outflowCents, 0);
    return { inflowCents, outflowCents, balanceCents: inflowCents - outflowCents, months, outflowByCategory };
  }
}

/**
 * Lógica de negócio — Dev 1 é o dono. RF-REL-005: receita mensal e maiores
 * proprietários por valor recebido. A quantidade de atendimentos vem do MS3
 * e os nomes, do MS1 — a PWA junta. Só no Plano Plus.
 */
export class DashboardService implements IDashboardService {
  constructor(private readonly repo: ReportRepository) {}

  async summary(ctx: RequestContext, period: ReportPeriod): Promise<DashboardSummary> {
    assertPlus(ctx);
    const { from, to } = parseReportPeriod(period);
    const [totals, topOwners] = await Promise.all([
      this.repo.monthlyTotals(ctx, from, to),
      this.repo.topOwnersByReceived(ctx, from, to, TOP_OWNERS),
    ]);
    return {
      monthlyRevenue: totals.map((m) => ({ month: m.month, amountCents: m.inflowCents })),
      topOwners,
    };
  }
}
