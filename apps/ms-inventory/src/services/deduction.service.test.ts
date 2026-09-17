import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DeductionService, deriveItemIdempotencyKey } from './deduction.service';
import type { IStockService } from '@quironequine/shared-types';
import type { DomainEvent } from '@quironequine/shared-types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const APPOINTMENT_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_A = '33333333-3333-3333-3333-333333333333';
const PRODUCT_B = '44444444-4444-4444-4444-444444444444';

function fakeStock(overrides: Partial<IStockService> = {}): IStockService {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    deduct: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IStockService;
}

function appointmentDoneEvent(
  consumedItems: Array<{ productId: string; quantity: number }>,
  overrides: Partial<DomainEvent<unknown>> = {},
): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId: TENANT_ID,
    traceId: 'test-trace',
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      appointmentId: APPOINTMENT_ID,
      ownerId: randomUUID(),
      totalCostCents: 5000,
      consumedItems,
    },
    ...overrides,
  };
}

describe('DeductionService.handle', () => {
  it('ignora jobs que não são appointment.done', async () => {
    const deduct = vi.fn();
    const service = new DeductionService(fakeStock({ deduct }));

    await service.handle('outro.evento', appointmentDoneEvent([{ productId: PRODUCT_A, quantity: 1 }]));

    expect(deduct).not.toHaveBeenCalled();
  });

  it('item único: chama deduct uma vez com a chave derivada e a referência do atendimento', async () => {
    const deduct = vi.fn().mockResolvedValue(undefined);
    const service = new DeductionService(fakeStock({ deduct }));
    const event = appointmentDoneEvent([{ productId: PRODUCT_A, quantity: 2 }]);

    await service.handle('appointment.done', event);

    const expectedKey = deriveItemIdempotencyKey(event.idempotencyKey, 0);
    expect(deduct).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      PRODUCT_A,
      2,
      expectedKey,
      { referenceId: APPOINTMENT_ID, referenceType: 'appointment' },
    );
  });

  it('múltiplos itens distintos: uma chamada por item, chaves distintas', async () => {
    const deduct = vi.fn().mockResolvedValue(undefined);
    const service = new DeductionService(fakeStock({ deduct }));
    const event = appointmentDoneEvent([
      { productId: PRODUCT_A, quantity: 1 },
      { productId: PRODUCT_B, quantity: 3 },
    ]);

    await service.handle('appointment.done', event);

    expect(deduct).toHaveBeenCalledTimes(2);
    const key0 = deriveItemIdempotencyKey(event.idempotencyKey, 0);
    const key1 = deriveItemIdempotencyKey(event.idempotencyKey, 1);
    expect(key0).not.toBe(key1);
    expect(deduct).toHaveBeenNthCalledWith(1, expect.anything(), PRODUCT_A, 1, key0, expect.anything());
    expect(deduct).toHaveBeenNthCalledWith(2, expect.anything(), PRODUCT_B, 3, key1, expect.anything());
  });

  it('mesmo productId duas vezes no mesmo evento: duas chamadas separadas, chaves distintas, quantidades preservadas', async () => {
    const deduct = vi.fn().mockResolvedValue(undefined);
    const service = new DeductionService(fakeStock({ deduct }));
    const event = appointmentDoneEvent([
      { productId: PRODUCT_A, quantity: 1 },
      { productId: PRODUCT_A, quantity: 5 },
    ]);

    await service.handle('appointment.done', event);

    expect(deduct).toHaveBeenCalledTimes(2);
    const key0 = deriveItemIdempotencyKey(event.idempotencyKey, 0);
    const key1 = deriveItemIdempotencyKey(event.idempotencyKey, 1);
    expect(key0).not.toBe(key1);
    expect(deduct).toHaveBeenNthCalledWith(1, expect.anything(), PRODUCT_A, 1, key0, expect.anything());
    expect(deduct).toHaveBeenNthCalledWith(2, expect.anything(), PRODUCT_A, 5, key1, expect.anything());
  });

  it('falha parcial: item seguinte ainda é tentado, handle() rejeita no final', async () => {
    const deduct = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('produto não encontrado'))
      .mockResolvedValueOnce(undefined);
    const service = new DeductionService(fakeStock({ deduct }));
    const event = appointmentDoneEvent([
      { productId: PRODUCT_A, quantity: 1 },
      { productId: PRODUCT_B, quantity: 1 },
      { productId: PRODUCT_A, quantity: 2 },
    ]);

    await expect(service.handle('appointment.done', event)).rejects.toThrow();

    expect(deduct).toHaveBeenCalledTimes(3);
  });

  it('todos os itens com sucesso: resolve sem lançar', async () => {
    const service = new DeductionService(fakeStock());
    const event = appointmentDoneEvent([{ productId: PRODUCT_A, quantity: 1 }]);

    await expect(service.handle('appointment.done', event)).resolves.toBeUndefined();
  });

  it('payload inválido (sem itens) rejeita antes de chamar deduct', async () => {
    const deduct = vi.fn();
    const service = new DeductionService(fakeStock({ deduct }));

    await expect(service.handle('appointment.done', appointmentDoneEvent([]))).rejects.toThrow();
    expect(deduct).not.toHaveBeenCalled();
  });
});

describe('deriveItemIdempotencyKey', () => {
  it('é determinística: mesmo par (chave, índice) sempre gera o mesmo UUID', () => {
    const key = randomUUID();
    expect(deriveItemIdempotencyKey(key, 0)).toBe(deriveItemIdempotencyKey(key, 0));
  });

  it('índices diferentes geram UUIDs diferentes pra mesma chave de envelope', () => {
    const key = randomUUID();
    expect(deriveItemIdempotencyKey(key, 0)).not.toBe(deriveItemIdempotencyKey(key, 1));
  });

  it('chaves de envelope diferentes geram UUIDs diferentes pro mesmo índice', () => {
    expect(deriveItemIdempotencyKey(randomUUID(), 0)).not.toBe(deriveItemIdempotencyKey(randomUUID(), 0));
  });

  it('gera um UUID sintaticamente válido (8-4-4-4-12 hex)', () => {
    const derived = deriveItemIdempotencyKey(randomUUID(), 0);
    expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
