import type { IInventorySettingsService, InventorySettings, RequestContext } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { InventorySettingsRepository } from '../repositories/inventory-settings.repository';

/** Mesmo teto do CHECK da migration. */
export const MAX_ALERT_DAYS = 3650;

/**
 * Lógica de negócio — Dev 1 é o dono. RF-CFG-004: limites de alerta de
 * estoque da clínica ("globalmente"); o produto pode ter os seus ("por
 * produto"), e o que vale é calculado no ProductRepository.
 */
export class InventorySettingsService implements IInventorySettingsService {
  constructor(private readonly repo: InventorySettingsRepository) {}

  get(ctx: RequestContext): Promise<InventorySettings> {
    return this.repo.get(ctx);
  }

  async update(ctx: RequestContext, data: Partial<InventorySettings>): Promise<InventorySettings> {
    const errors: Array<{ field: string; message: string }> = [];
    const days = data.defaultAlertDaysBefore;
    if (days !== undefined && days !== null && (!Number.isInteger(days) || days < 0 || days > MAX_ALERT_DAYS)) {
      errors.push({ field: 'defaultAlertDaysBefore', message: `Use de 0 a ${MAX_ALERT_DAYS} dias` });
    }
    const qty = data.defaultMinStockQty;
    if (qty !== undefined && qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      errors.push({ field: 'defaultMinStockQty', message: 'O estoque mínimo não pode ser negativo' });
    }
    if (errors.length > 0) throw AppError.validation('Limites de alerta inválidos', errors);

    const changes: Partial<InventorySettings> = {};
    if (days !== undefined) changes.defaultAlertDaysBefore = days;
    if (qty !== undefined) changes.defaultMinStockQty = qty;
    return this.repo.upsert(ctx, changes);
  }
}
