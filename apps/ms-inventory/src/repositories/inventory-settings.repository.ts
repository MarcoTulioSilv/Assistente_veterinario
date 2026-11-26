import type { RequestContext, InventorySettings } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

/**
 * Padrão do sistema enquanto a clínica não configura (RF-CFG-004) — o mesmo
 * que valia quando o limite era só do produto (30 dias de aviso de validade,
 * nenhum estoque mínimo).
 */
export const SYSTEM_INVENTORY_DEFAULTS: InventorySettings = {
  defaultAlertDaysBefore: 30,
  defaultMinStockQty: null,
};

/** O mínimo de uma transação do Prisma para ler a configuração. */
interface SettingsTx {
  inventorySettings: {
    findUnique(args: { where: { tenantId: string } }): Promise<{
      defaultAlertDaysBefore: number | null;
      defaultMinStockQty: { toNumber(): number } | null;
    } | null>;
  };
}

/** Configuração da clínica, já dentro de um withTenant (o ProductRepository usa para os alertas). */
export async function loadInventorySettings(tx: SettingsTx, tenantId: string): Promise<InventorySettings> {
  const row = await tx.inventorySettings.findUnique({ where: { tenantId } });
  if (!row) return SYSTEM_INVENTORY_DEFAULTS;
  return {
    defaultAlertDaysBefore: row.defaultAlertDaysBefore,
    defaultMinStockQty: row.defaultMinStockQty ? row.defaultMinStockQty.toNumber() : null,
  };
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Limites de alerta padrão da
 * clínica (RF-CFG-004). Uma linha por clínica; sem linha, vale o padrão do
 * sistema.
 */
export class InventorySettingsRepository {
  async get(ctx: RequestContext): Promise<InventorySettings> {
    return withTenant(ctx.tenantId, (tx) => loadInventorySettings(tx, ctx.tenantId));
  }

  /** Campo ausente mantém o valor atual (ou o padrão do sistema, na primeira gravação). */
  async upsert(ctx: RequestContext, data: Partial<InventorySettings>): Promise<InventorySettings> {
    return withTenant(ctx.tenantId, async (tx) => {
      const current = await loadInventorySettings(tx, ctx.tenantId);
      const next = { ...current, ...data };
      await tx.inventorySettings.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, ...next },
        update: next,
      });
      return next;
    });
  }
}
