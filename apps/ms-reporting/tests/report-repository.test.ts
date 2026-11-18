/**
 * Integração das saídas, do fluxo de caixa e do dashboard (Sprint 11 do M3)
 * contra Postgres de verdade, com a role da aplicação.
 *
 * O que só um teste assim prova:
 *  - o mês das entradas é o de São Paulo (pagamento às 23h30 de 31/10 é outubro);
 *  - saída excluída, pendência não paga e outro tenant ficam fora das contas;
 *  - o período respeita as pontas (fim exclusivo) nos dois lados;
 *  - toda escrita de saída vai para o audit_log, sem os valores.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@quironequine/shared-types';
import { prisma } from '../src/prisma';
import { admin, purgeTenants } from './admin-db';
import { ExpenseRepository } from '../src/repositories/expense.repository';
import { ReportRepository } from '../src/repositories/report.repository';
import { FinancialRepository } from '../src/repositories/financial.repository';
import { ExpenseService } from '../src/services/expense.service';
import { CashFlowService, DashboardService } from '../src/services/cash-flow.service';
import { FinancialService } from '../src/services/financial.service';

const TENANT_A = 'f1000000-0000-0000-0000-000000000000';
const TENANT_B = 'f2000000-0000-0000-0000-000000000000';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}
const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const expenses = new ExpenseService(new ExpenseRepository());
const reports = new ReportRepository();
const cashFlow = new CashFlowService(reports);
const dashboard = new DashboardService(reports);
const financial = new FinancialService(new FinancialRepository(), async () => {});

/** Set–Nov/2026, em instantes de São Paulo. */
const PERIOD = { from: '2026-09-01T03:00:00.000Z', to: '2026-12-01T03:00:00.000Z' };

const OWNER_1 = randomUUID();
const OWNER_2 = randomUUID();

async function payment(
  tenantId: string,
  ownerId: string,
  amountCents: number,
  paidAt: string | null,
  occurredAt = '2026-10-15T15:00:00Z',
): Promise<void> {
  await admin.financialRecord.create({
    data: {
      tenantId,
      ownerId,
      sourceType: 'appointment',
      sourceId: randomUUID(),
      amountCents,
      status: paidAt ? 'received' : 'pending',
      occurredAt: new Date(occurredAt),
      paidAt: paidAt ? new Date(paidAt) : null,
      idempotencyKey: randomUUID(),
    },
  });
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

describe('fluxo de caixa (RF-REL-001)', () => {
  it('entradas pelo mês de São Paulo do pagamento, saídas pelo dia, nas pontas certas', async () => {
    await payment(TENANT_A, OWNER_1, 50000, '2026-09-10T15:00:00Z');
    await payment(TENANT_A, OWNER_1, 20000, '2026-11-01T02:30:00Z'); // 23h30 de 31/10 em SP → outubro
    await payment(TENANT_A, OWNER_2, 99999, null); // pendente: não é entrada
    await payment(TENANT_A, OWNER_2, 77777, '2026-12-01T03:00:00Z'); // já é dezembro em SP: fora
    await payment(TENANT_B, OWNER_1, 88888, '2026-10-10T15:00:00Z'); // outra clínica

    await expenses.create(ctxA, { occurredOn: '2026-10-05', category: 'fuel', description: 'Gasolina', amountCents: 15000 });
    await expenses.create(ctxA, { occurredOn: '2026-11-30', category: 'taxes_fees', description: 'ISS', amountCents: 5000 });
    await expenses.registerStockPurchase(ctxA, { occurredOn: '2026-11-12', amountCents: 30000 });
    const apagada = await expenses.create(ctxA, { occurredOn: '2026-11-13', category: 'other', description: 'Erro', amountCents: 1 });
    await expenses.remove(ctxA, apagada.id);
    await expenses.create(ctxA, { occurredOn: '2026-12-01', category: 'fuel', description: 'Dezembro', amountCents: 4444 });

    const summary = await cashFlow.summary(ctxA, PERIOD);

    expect(summary.months).toEqual([
      { month: '2026-09', inflowCents: 50000, outflowCents: 0, balanceCents: 50000 },
      { month: '2026-10', inflowCents: 20000, outflowCents: 15000, balanceCents: 5000 },
      { month: '2026-11', inflowCents: 0, outflowCents: 35000, balanceCents: -35000 },
    ]);
    expect(summary).toMatchObject({ inflowCents: 70000, outflowCents: 50000, balanceCents: 20000 });
    expect(summary.outflowByCategory).toEqual([
      { category: 'stock_purchase', amountCents: 30000 },
      { category: 'fuel', amountCents: 15000 },
      { category: 'taxes_fees', amountCents: 5000 },
    ]);
  });
});

describe('dashboard (RF-REL-005)', () => {
  it('maiores proprietários pelo valor recebido no período, só da clínica', async () => {
    await payment(TENANT_A, OWNER_1, 10000, '2026-10-01T15:00:00Z');
    await payment(TENANT_A, OWNER_1, 10000, '2026-10-02T15:00:00Z');
    await payment(TENANT_A, OWNER_2, 30000, '2026-10-03T15:00:00Z');
    await payment(TENANT_B, OWNER_1, 99999, '2026-10-03T15:00:00Z');

    const summary = await dashboard.summary(ctxA, PERIOD);

    expect(summary.topOwners).toEqual([
      { ownerId: OWNER_2, amountCents: 30000, payments: 1 },
      { ownerId: OWNER_1, amountCents: 20000, payments: 2 },
    ]);
    expect(summary.monthlyRevenue.map((m) => m.amountCents)).toEqual([0, 50000, 0]);
    expect((await dashboard.summary(ctxB, PERIOD)).topOwners).toEqual([{ ownerId: OWNER_1, amountCents: 99999, payments: 1 }]);
  });
});

describe('saídas (RF-REL-002)', () => {
  it('lista por dia (os dois incluídos) e categoria, sem as excluídas nem as de outra clínica', async () => {
    await expenses.create(ctxA, { occurredOn: '2026-11-01', category: 'fuel', description: 'A', amountCents: 100 });
    await expenses.create(ctxA, { occurredOn: '2026-11-30', category: 'fuel', description: 'B', amountCents: 200 });
    await expenses.create(ctxA, { occurredOn: '2026-12-01', category: 'fuel', description: 'C', amountCents: 300 });
    await expenses.create(ctxA, { occurredOn: '2026-11-15', category: 'other', description: 'D', amountCents: 400 });
    await expenses.create(ctxB, { occurredOn: '2026-11-15', category: 'fuel', description: 'E', amountCents: 500 });

    const page = await expenses.list(ctxA, { fromDay: '2026-11-01', toDay: '2026-11-30', category: 'fuel' });

    expect(page.data.map((e) => e.description)).toEqual(['B', 'A']);
  });

  it('criar, editar e excluir passam pelo audit_log com os nomes dos campos, nunca os valores', async () => {
    const created = await expenses.create(ctxA, { occurredOn: '2026-11-01', category: 'fuel', description: 'Posto Ipiranga', amountCents: 12345 });
    await expenses.update(ctxA, created.id, { amountCents: 54321 });
    await expenses.remove(ctxA, created.id);

    const audit = await admin.auditLog.findMany({ where: { tenantId: TENANT_A, recordId: created.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
    expect(JSON.stringify(audit)).not.toMatch(/Ipiranga|12345|54321/);
    await expect(expenses.update(ctxA, created.id, { amountCents: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('o banco recusa produto em saída avulsa e valor não positivo, mesmo sem passar pelo service', async () => {
    const base = { tenantId: TENANT_A, occurredOn: new Date('2026-11-01T00:00:00Z'), createdBy: randomUUID() };
    await expect(
      admin.expense.create({ data: { ...base, category: 'fuel', amountCents: 100, productId: randomUUID() } }),
    ).rejects.toThrow(/expenses_product_only_on_stock_purchase/);
    await expect(admin.expense.create({ data: { ...base, category: 'fuel', amountCents: 0 } })).rejects.toThrow(
      /expenses_amount_positive/,
    );
  });
});

describe('pendências por período (RF-REL-003)', () => {
  it('filtra pela data do serviço', async () => {
    await payment(TENANT_A, OWNER_1, 100, null, '2026-10-15T15:00:00Z');
    await payment(TENANT_A, OWNER_1, 200, null, '2026-11-15T15:00:00Z');

    const page = await financial.list(ctxA, {
      page: 1,
      limit: 20,
      status: 'pending',
      from: '2026-11-01T03:00:00Z',
      to: '2026-12-01T03:00:00Z',
    });

    expect(page.data.map((r) => r.amountCents)).toEqual([200]);
  });
});
