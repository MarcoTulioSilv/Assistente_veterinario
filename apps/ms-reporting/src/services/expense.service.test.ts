import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, Expense } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ExpenseRepository } from '../repositories/expense.repository';
import { ExpenseService } from './expense.service';

const plus: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 't',
};
const basic: RequestContext = { ...plus, plan: 'basic' };
const NOW = new Date('2026-11-18T12:00:00Z');

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    occurredOn: '2026-11-10',
    category: 'fuel',
    description: 'Gasolina',
    amountCents: 25000,
    productId: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function setup(current: Expense | null = expense()) {
  const repo = {
    list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
    findById: vi.fn().mockResolvedValue(current),
    create: vi.fn().mockImplementation(async (_ctx, data) => expense(data)),
    update: vi.fn().mockImplementation(async (_ctx, _id, patch) => expense(patch)),
    softDelete: vi.fn().mockResolvedValue(true),
  };
  return { repo, service: new ExpenseService(repo as unknown as ExpenseRepository, () => NOW) };
}

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

describe('ExpenseService — Plano Plus (ERS §2.6)', () => {
  it('no Básico, toda operação de saída é recusada (403)', async () => {
    const { service, repo } = setup();
    await rejects(service.list(basic, {}), 'FORBIDDEN');
    await rejects(service.create(basic, { occurredOn: '2026-11-10', category: 'fuel', description: 'x', amountCents: 1 }), 'FORBIDDEN');
    await rejects(service.registerStockPurchase(basic, { occurredOn: '2026-11-10', amountCents: 1 }), 'FORBIDDEN');
    await rejects(service.update(basic, 'e1', {}), 'FORBIDDEN');
    await rejects(service.remove(basic, 'e1'), 'FORBIDDEN');
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ExpenseService.create (RF-REL-002)', () => {
  it('grava a saída avulsa com descrição limpa e sem produto', async () => {
    const { service, repo } = setup();
    await service.create(plus, { occurredOn: '2026-11-10', category: 'fuel', description: '  Gasolina  ', amountCents: 25000 });
    expect(repo.create).toHaveBeenCalledWith(plus, {
      occurredOn: '2026-11-10',
      category: 'fuel',
      description: 'Gasolina',
      amountCents: 25000,
      productId: null,
    });
  });

  it('recusa data inválida, valor zero ou fracionado, sem descrição, e categoria de compra de estoque', async () => {
    const { service, repo } = setup();
    const ok = { occurredOn: '2026-11-10', category: 'fuel' as const, description: 'x', amountCents: 100 };
    for (const data of [
      { ...ok, occurredOn: '2026-02-30' },
      { ...ok, occurredOn: '10/11/2026' },
      { ...ok, amountCents: 0 },
      { ...ok, amountCents: 10.5 },
      { ...ok, description: '   ' },
      { ...ok, category: 'stock_purchase' as never },
    ]) {
      await rejects(service.create(plus, data), 'VALIDATION_ERROR');
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ExpenseService.registerStockPurchase (regra mínima)', () => {
  it('grava como compra de estoque, com produto e descrição opcionais', async () => {
    const { service, repo } = setup();
    await service.registerStockPurchase(plus, { occurredOn: '2026-11-12', amountCents: 80000, productId: 'p1' });
    expect(repo.create).toHaveBeenCalledWith(plus, {
      occurredOn: '2026-11-12',
      category: 'stock_purchase',
      description: null,
      amountCents: 80000,
      productId: 'p1',
    });
  });
});

describe('ExpenseService.update / remove', () => {
  it('grava só o que mudou', async () => {
    const { service, repo } = setup();
    await service.update(plus, 'e1', { amountCents: 30000 });
    expect(repo.update).toHaveBeenCalledWith(plus, 'e1', { amountCents: 30000 });
  });

  it('compra de estoque não vira avulsa nem o contrário; avulsa não fica sem descrição', async () => {
    await rejects(setup(expense({ category: 'stock_purchase' })).service.update(plus, 'e1', { category: 'fuel' }), 'VALIDATION_ERROR');
    await rejects(setup().service.update(plus, 'e1', { category: 'stock_purchase' as never }), 'VALIDATION_ERROR');
    await rejects(setup().service.update(plus, 'e1', { description: '' }), 'VALIDATION_ERROR');
  });

  it('a compra de estoque pode ficar sem descrição', async () => {
    const { service, repo } = setup(expense({ category: 'stock_purchase', description: 'NF 123' }));
    await service.update(plus, 'e1', { description: '' });
    expect(repo.update).toHaveBeenCalledWith(plus, 'e1', { description: null });
  });

  it('inexistente: 404 na edição e na exclusão', async () => {
    await rejects(setup(null).service.update(plus, 'x', {}), 'NOT_FOUND');
    const { service, repo } = setup();
    repo.softDelete.mockResolvedValue(false);
    await rejects(service.remove(plus, 'x'), 'NOT_FOUND');
  });

  it('exclui com a hora atual', async () => {
    const { service, repo } = setup();
    await service.remove(plus, 'e1');
    expect(repo.softDelete).toHaveBeenCalledWith(plus, 'e1', NOW);
  });
});

describe('ExpenseService.list', () => {
  it('saneia página e limite e repassa o período e a categoria', async () => {
    const { service, repo } = setup();
    await service.list(plus, { page: 0, limit: 500, fromDay: '2026-11-01', toDay: '2026-11-30', category: 'fuel' });
    expect(repo.list).toHaveBeenCalledWith(plus, { page: 1, limit: 100, fromDay: '2026-11-01', toDay: '2026-11-30', category: 'fuel' });
  });

  it('recusa dia inválido, fim antes do início e mais de 24 meses', async () => {
    const { service } = setup();
    await rejects(service.list(plus, { fromDay: '2026-13-01' }), 'VALIDATION_ERROR');
    await rejects(service.list(plus, { fromDay: '2026-11-30', toDay: '2026-11-01' }), 'VALIDATION_ERROR');
    await rejects(service.list(plus, { fromDay: '2023-01-01', toDay: '2026-01-01' }), 'VALIDATION_ERROR');
  });
});
