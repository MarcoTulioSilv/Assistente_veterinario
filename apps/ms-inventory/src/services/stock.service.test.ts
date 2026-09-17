import { describe, it, expect, vi } from 'vitest';
import { StockService } from './stock.service';
import type { ProductRepository } from '../repositories/product.repository';
import type { MovementRepository, StockMovementRecord } from '../repositories/movement.repository';
import type { RequestContext, Product } from '@vetequine/shared-types';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

const product: Product = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Vacina Tétano',
  manufacturer: 'Labtest',
  batch: 'L-2026-01',
  unit: 'frasco',
  quantityInStock: 10,
  dosesPerUnit: 5,
  costPriceCents: 1000,
  markupPercent: 20,
  salePriceCents: 1200,
  expiryDate: null,
  alertDaysBefore: 30,
  minStockQty: 2,
  category: 'vaccine',
  isNearExpiry: false,
  isLowStock: false,
};

const movement: StockMovementRecord = {
  id: '44444444-4444-4444-4444-444444444444',
  productId: product.id,
  type: 'out',
  quantity: 1,
  reason: 'appointment',
  referenceId: null,
  referenceType: null,
  notes: null,
  createdBy: null,
  createdAt: new Date().toISOString(),
};

function fakeProducts(overrides: Partial<ProductRepository> = {}): ProductRepository {
  return {
    list: vi.fn().mockResolvedValue({ data: [product], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    findById: vi.fn().mockResolvedValue(product),
    create: vi.fn().mockResolvedValue(product),
    update: vi.fn().mockResolvedValue(product),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ProductRepository;
}

function fakeMovements(overrides: Partial<MovementRepository> = {}): MovementRepository {
  return {
    record: vi.fn().mockResolvedValue(movement),
    list: vi.fn().mockResolvedValue({ data: [movement], total: 1 }),
    ...overrides,
  } as unknown as MovementRepository;
}

describe('StockService.list / findById', () => {
  it('delega list() pro repositório', async () => {
    const products = fakeProducts();
    const service = new StockService(products, fakeMovements());

    const result = await service.list(ctx, { page: 1, limit: 20 });

    expect(result.data).toEqual([product]);
    expect(products.list).toHaveBeenCalledWith(ctx, { page: 1, limit: 20 });
  });

  it('delega findById() pro repositório', async () => {
    const service = new StockService(fakeProducts(), fakeMovements());

    await expect(service.findById(ctx, product.id)).resolves.toEqual(product);
  });
});

describe('StockService.create', () => {
  it('delega create() pro repositório sem checagem de limite de plano', async () => {
    const create = vi.fn().mockResolvedValue(product);
    const service = new StockService(fakeProducts({ create }), fakeMovements());

    const input = { name: 'Vacina Tétano', unit: 'frasco' as const, costPriceCents: 1000, category: 'vaccine' as const };
    await service.create(ctx, input);

    expect(create).toHaveBeenCalledWith(ctx, input);
  });
});

describe('StockService.update', () => {
  it('rejeita quando o produto não existe', async () => {
    const service = new StockService(fakeProducts({ findById: vi.fn().mockResolvedValue(null) }), fakeMovements());

    await expect(service.update(ctx, 'id-inexistente', { name: 'X' })).rejects.toThrow(/não encontrado/);
  });

  it('atualiza quando o produto existe', async () => {
    const update = vi.fn().mockResolvedValue({ ...product, name: 'Nome Atualizado' });
    const service = new StockService(fakeProducts({ update }), fakeMovements());

    const result = await service.update(ctx, product.id, { name: 'Nome Atualizado' });

    expect(update).toHaveBeenCalledWith(ctx, product.id, { name: 'Nome Atualizado' });
    expect(result.name).toBe('Nome Atualizado');
  });
});

describe('StockService.softDelete', () => {
  it('rejeita quando o produto não existe', async () => {
    const service = new StockService(fakeProducts({ findById: vi.fn().mockResolvedValue(null) }), fakeMovements());

    await expect(service.softDelete(ctx, 'id-inexistente')).rejects.toThrow(/não encontrado/);
  });

  it('remove (soft delete) quando o produto existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new StockService(fakeProducts({ softDelete }), fakeMovements());

    await service.softDelete(ctx, product.id);

    expect(softDelete).toHaveBeenCalledWith(ctx, product.id);
  });
});

describe('StockService.deduct', () => {
  it('rejeita quando o produto não existe', async () => {
    const service = new StockService(fakeProducts({ findById: vi.fn().mockResolvedValue(null) }), fakeMovements());

    await expect(service.deduct(ctx, 'id-inexistente', 1, movement.id)).rejects.toThrow(/não encontrado/);
  });

  it('registra a baixa como saída com motivo appointment, repassando a idempotencyKey', async () => {
    const record = vi.fn().mockResolvedValue(movement);
    const service = new StockService(fakeProducts(), fakeMovements({ record }));

    await service.deduct(ctx, product.id, 2, 'evt-idempotency-key');

    expect(record).toHaveBeenCalledWith(ctx, product.id, {
      type: 'out',
      quantity: 2,
      reason: 'appointment',
      idempotencyKey: 'evt-idempotency-key',
      referenceId: null,
      referenceType: null,
    });
  });

  it('sem reference, referenceId/referenceType ficam null (compatibilidade com quem já chama sem o parâmetro)', async () => {
    const record = vi.fn().mockResolvedValue(movement);
    const service = new StockService(fakeProducts(), fakeMovements({ record }));

    await service.deduct(ctx, product.id, 2, 'evt-idempotency-key');

    expect(record).toHaveBeenCalledWith(
      ctx,
      product.id,
      expect.objectContaining({ referenceId: null, referenceType: null }),
    );
  });

  it('com reference, repassa referenceId/referenceType pro repositório', async () => {
    const record = vi.fn().mockResolvedValue(movement);
    const service = new StockService(fakeProducts(), fakeMovements({ record }));

    await service.deduct(ctx, product.id, 2, 'evt-idempotency-key', {
      referenceId: 'appointment-id-123',
      referenceType: 'appointment',
    });

    expect(record).toHaveBeenCalledWith(ctx, product.id, {
      type: 'out',
      quantity: 2,
      reason: 'appointment',
      idempotencyKey: 'evt-idempotency-key',
      referenceId: 'appointment-id-123',
      referenceType: 'appointment',
    });
  });

  it('é idempotente: chamar duas vezes com a mesma idempotencyKey delega ambas ao repositório, que garante não duplicar (unique key)', async () => {
    const record = vi.fn().mockResolvedValue(movement);
    const service = new StockService(fakeProducts(), fakeMovements({ record }));

    await service.deduct(ctx, product.id, 2, 'chave-repetida');
    await service.deduct(ctx, product.id, 2, 'chave-repetida');

    expect(record).toHaveBeenNthCalledWith(1, ctx, product.id, {
      type: 'out',
      quantity: 2,
      reason: 'appointment',
      idempotencyKey: 'chave-repetida',
      referenceId: null,
      referenceType: null,
    });
    expect(record).toHaveBeenNthCalledWith(2, ctx, product.id, {
      type: 'out',
      quantity: 2,
      reason: 'appointment',
      idempotencyKey: 'chave-repetida',
      referenceId: null,
      referenceType: null,
    });
  });
});

describe('StockService.recordMovement', () => {
  it('rejeita quando o produto não existe', async () => {
    const service = new StockService(fakeProducts({ findById: vi.fn().mockResolvedValue(null) }), fakeMovements());

    await expect(
      service.recordMovement(ctx, 'id-inexistente', { type: 'in', quantity: 1, reason: 'purchase' }),
    ).rejects.toThrow(/não encontrado/);
  });

  it('registra o lançamento manual quando o produto existe', async () => {
    const record = vi.fn().mockResolvedValue(movement);
    const service = new StockService(fakeProducts(), fakeMovements({ record }));

    await service.recordMovement(ctx, product.id, { type: 'in', quantity: 5, reason: 'purchase', notes: 'Compra' });

    expect(record).toHaveBeenCalledWith(ctx, product.id, {
      type: 'in',
      quantity: 5,
      reason: 'purchase',
      notes: 'Compra',
    });
  });
});

describe('StockService.listMovements', () => {
  it('delega pro repositório de movimentações', async () => {
    const service = new StockService(fakeProducts(), fakeMovements());

    const result = await service.listMovements(ctx, product.id, { page: 1, limit: 20 });

    expect(result.data).toEqual([movement]);
  });
});
