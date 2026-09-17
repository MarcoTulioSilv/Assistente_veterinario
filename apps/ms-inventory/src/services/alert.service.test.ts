import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishDomainEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../events/publisher', () => ({ publishDomainEvent: (...args: unknown[]) => publishDomainEvent(...args) }));

const { AlertService } = await import('./alert.service');
type ProductRepository = import('../repositories/product.repository').ProductRepository;
type AlertConfigRepository = import('../repositories/alert-config.repository').AlertConfigRepository;

import type { RequestContext, Product } from '@quironequine/shared-types';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Produto Teste',
    manufacturer: null,
    batch: null,
    unit: 'unidade',
    quantityInStock: 10,
    dosesPerUnit: null,
    costPriceCents: 100,
    markupPercent: 0,
    salePriceCents: 100,
    expiryDate: null,
    alertDaysBefore: 30,
    minStockQty: 0,
    category: 'supply',
    isNearExpiry: false,
    isLowStock: false,
    ...overrides,
  };
}

function fakeProducts(overrides: Partial<ProductRepository> = {}): ProductRepository {
  return {
    listActiveTenantIds: vi.fn().mockResolvedValue([ctx.tenantId]),
    listAllActive: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ProductRepository;
}

function fakeAlerts(overrides: Partial<AlertConfigRepository> = {}): AlertConfigRepository {
  return {
    findByProductAndType: vi.fn().mockResolvedValue(null),
    markTriggered: vi.fn().mockResolvedValue(undefined),
    clearTriggered: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AlertConfigRepository;
}

beforeEach(() => {
  publishDomainEvent.mockClear();
});

describe('AlertService.checkTenant', () => {
  it('dispara e publica quando o produto entra em alerta de validade pela primeira vez', async () => {
    const p = product({ isNearExpiry: true, expiryDate: '2027-01-01T00:00:00.000Z' });
    const markTriggered = vi.fn().mockResolvedValue(undefined);
    const service = new AlertService(fakeProducts({ listAllActive: vi.fn().mockResolvedValue([p]) }), fakeAlerts({ markTriggered }));

    await service.checkTenant(ctx);

    expect(markTriggered).toHaveBeenCalledWith(ctx, p.id, 'expiry');
    expect(publishDomainEvent).toHaveBeenCalledTimes(1);
    const event = publishDomainEvent.mock.calls[0]?.[0];
    expect(event.name).toBe('alert.triggered');
    expect(event.payload).toMatchObject({ productId: p.id, alertType: 'expiry', expiryDate: p.expiryDate });
  });

  it('não dispara de novo se o alerta já foi disparado e a condição continua', async () => {
    const p = product({ isLowStock: true });
    const markTriggered = vi.fn().mockResolvedValue(undefined);
    const service = new AlertService(
      fakeProducts({ listAllActive: vi.fn().mockResolvedValue([p]) }),
      fakeAlerts({ findByProductAndType: vi.fn().mockResolvedValue({ id: 'x', lastTriggeredAt: new Date() }), markTriggered }),
    );

    await service.checkTenant(ctx);

    expect(markTriggered).not.toHaveBeenCalled();
    expect(publishDomainEvent).not.toHaveBeenCalled();
  });

  it('limpa lastTriggeredAt quando a condição normaliza', async () => {
    const p = product({ isLowStock: false });
    const clearTriggered = vi.fn().mockResolvedValue(undefined);
    const service = new AlertService(
      fakeProducts({ listAllActive: vi.fn().mockResolvedValue([p]) }),
      fakeAlerts({ findByProductAndType: vi.fn().mockResolvedValue({ id: 'x', lastTriggeredAt: new Date() }), clearTriggered }),
    );

    await service.checkTenant(ctx);

    expect(clearTriggered).toHaveBeenCalledWith(ctx, p.id, 'low_stock');
  });

  it('não faz nada se o produto nunca esteve em alerta e continua normal', async () => {
    const p = product({ isNearExpiry: false, isLowStock: false });
    const markTriggered = vi.fn().mockResolvedValue(undefined);
    const clearTriggered = vi.fn().mockResolvedValue(undefined);
    const service = new AlertService(fakeProducts({ listAllActive: vi.fn().mockResolvedValue([p]) }), fakeAlerts({ markTriggered, clearTriggered }));

    await service.checkTenant(ctx);

    expect(markTriggered).not.toHaveBeenCalled();
    expect(clearTriggered).not.toHaveBeenCalled();
    expect(publishDomainEvent).not.toHaveBeenCalled();
  });

  it('avalia expiry e low_stock independentemente pro mesmo produto', async () => {
    const p = product({ isNearExpiry: true, isLowStock: true, expiryDate: '2027-01-01T00:00:00.000Z' });
    const markTriggered = vi.fn().mockResolvedValue(undefined);
    const service = new AlertService(fakeProducts({ listAllActive: vi.fn().mockResolvedValue([p]) }), fakeAlerts({ markTriggered }));

    await service.checkTenant(ctx);

    expect(markTriggered).toHaveBeenCalledWith(ctx, p.id, 'expiry');
    expect(markTriggered).toHaveBeenCalledWith(ctx, p.id, 'low_stock');
    expect(publishDomainEvent).toHaveBeenCalledTimes(2);
  });
});

describe('AlertService.checkAllTenants', () => {
  it('varre todos os tenants retornados por listActiveTenantIds', async () => {
    const listAllActive = vi.fn().mockResolvedValue([]);
    const service = new AlertService(
      fakeProducts({ listActiveTenantIds: vi.fn().mockResolvedValue(['t1', 't2']), listAllActive }),
      fakeAlerts(),
    );

    await service.checkAllTenants();

    expect(listAllActive).toHaveBeenCalledTimes(2);
  });
});
