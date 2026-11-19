import { describe, it, expect, vi } from 'vitest';
import type { RequestContext } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { InventorySettingsRepository } from '../repositories/inventory-settings.repository';
import { InventorySettingsService } from './inventory-settings.service';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 't',
};

function setup() {
  const repo = {
    get: vi.fn().mockResolvedValue({ defaultAlertDaysBefore: 30, defaultMinStockQty: null }),
    upsert: vi.fn().mockImplementation(async (_ctx, data) => ({ defaultAlertDaysBefore: 30, defaultMinStockQty: null, ...data })),
  };
  return { repo, service: new InventorySettingsService(repo as unknown as InventorySettingsRepository) };
}

describe('InventorySettingsService (RF-CFG-004)', () => {
  it('lê a configuração da clínica', async () => {
    const { service } = setup();
    expect(await service.get(ctx)).toEqual({ defaultAlertDaysBefore: 30, defaultMinStockQty: null });
  });

  it('grava só o que veio; null tira o padrão', async () => {
    const { service, repo } = setup();
    await service.update(ctx, { defaultMinStockQty: 5 });
    expect(repo.upsert).toHaveBeenLastCalledWith(ctx, { defaultMinStockQty: 5 });

    await service.update(ctx, { defaultAlertDaysBefore: null });
    expect(repo.upsert).toHaveBeenLastCalledWith(ctx, { defaultAlertDaysBefore: null });
  });

  it('recusa dias fora de 0 a 3650 ou fracionados, e estoque negativo', async () => {
    const { service, repo } = setup();
    for (const data of [{ defaultAlertDaysBefore: -1 }, { defaultAlertDaysBefore: 4000 }, { defaultAlertDaysBefore: 1.5 }, { defaultMinStockQty: -2 }]) {
      await expect(service.update(ctx, data)).rejects.toBeInstanceOf(AppError);
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
