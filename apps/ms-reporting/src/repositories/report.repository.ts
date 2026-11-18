import type { RequestContext, UUID, ExpenseCategory } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

export interface MonthlyTotals {
  month: string;
  inflowCents: number;
  outflowCents: number;
}

export interface OwnerTotal {
  ownerId: UUID;
  amountCents: number;
  payments: number;
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Agregações do fluxo de caixa
 * (RF-REL-001) e do dashboard (RF-REL-005), em SQL dentro do withTenant: o
 * RLS vale também no SQL cru.
 *
 * Datas: o período é [from, to) em instantes; o mês é o de São Paulo.
 * Entrada conta pela data do PAGAMENTO (paid_at, regime de caixa — pauta de
 * 18/11/2026, item 3); saída, pelo dia informado (occurred_on, DATE).
 */
export class ReportRepository {
  /** Entradas e saídas por mês, com zero nos meses vazios. */
  async monthlyTotals(ctx: RequestContext, from: Date, to: Date): Promise<MonthlyTotals[]> {
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ month: string; inflow: bigint; outflow: bigint }>>`
        WITH months AS (
          SELECT to_char(m, 'YYYY-MM') AS month
          FROM generate_series(
            date_trunc('month', ${from}::timestamptz AT TIME ZONE 'America/Sao_Paulo'),
            date_trunc('month', (${to}::timestamptz - INTERVAL '1 microsecond') AT TIME ZONE 'America/Sao_Paulo'),
            INTERVAL '1 month'
          ) AS m
        ),
        inflow AS (
          SELECT to_char(date_trunc('month', paid_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
                 sum(amount_cents) AS total
          FROM financial_records
          WHERE status = 'received' AND deleted_at IS NULL
            AND paid_at >= ${from}::timestamptz AND paid_at < ${to}::timestamptz
          GROUP BY 1
        ),
        outflow AS (
          SELECT to_char(occurred_on, 'YYYY-MM') AS month, sum(amount_cents) AS total
          FROM expenses
          WHERE deleted_at IS NULL
            AND occurred_on >= (${from}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            AND occurred_on < (${to}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          GROUP BY 1
        )
        SELECT months.month,
               COALESCE(inflow.total, 0) AS inflow,
               COALESCE(outflow.total, 0) AS outflow
        FROM months
        LEFT JOIN inflow ON inflow.month = months.month
        LEFT JOIN outflow ON outflow.month = months.month
        ORDER BY months.month
      `;
      return rows.map((r) => ({ month: r.month, inflowCents: Number(r.inflow), outflowCents: Number(r.outflow) }));
    });
  }

  /** Saídas do período por categoria (só as que tiveram saída). */
  async outflowByCategory(
    ctx: RequestContext,
    from: Date,
    to: Date,
  ): Promise<Array<{ category: ExpenseCategory; amountCents: number }>> {
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ category: ExpenseCategory; total: bigint }>>`
        SELECT category::text AS category, sum(amount_cents) AS total
        FROM expenses
        WHERE deleted_at IS NULL
          AND occurred_on >= (${from}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          AND occurred_on < (${to}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
        GROUP BY category
        ORDER BY total DESC, category
      `;
      return rows.map((r) => ({ category: r.category, amountCents: Number(r.total) }));
    });
  }

  /** RF-REL-005: proprietários que mais pagaram no período. */
  async topOwnersByReceived(ctx: RequestContext, from: Date, to: Date, limit: number): Promise<OwnerTotal[]> {
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ owner_id: string; total: bigint; payments: bigint }>>`
        SELECT owner_id, sum(amount_cents) AS total, count(*) AS payments
        FROM financial_records
        WHERE status = 'received' AND deleted_at IS NULL
          AND paid_at >= ${from}::timestamptz AND paid_at < ${to}::timestamptz
        GROUP BY owner_id
        ORDER BY total DESC, owner_id
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ ownerId: r.owner_id, amountCents: Number(r.total), payments: Number(r.payments) }));
    });
  }
}
