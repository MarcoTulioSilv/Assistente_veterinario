import { randomUUID } from 'node:crypto';
import type { AlertType } from '../../node_modules/.prisma/client-inventory';
import { EVENTS } from '@vetequine/shared-types';
import type { RequestContext, UUID, Product } from '@vetequine/shared-types';
import type { ProductRepository } from '../repositories/product.repository';
import type { AlertConfigRepository } from '../repositories/alert-config.repository';
import { publishDomainEvent } from '../events/publisher';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

function systemCtx(tenantId: UUID): RequestContext {
  return {
    tenantId,
    userId: SYSTEM_USER_ID,
    role: 'admin',
    plan: 'plus',
    traceId: `alert-check-${randomUUID()}`,
  };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * RF-EST-004/005 (RN-009): detecta produtos em alerta e publica
 * alert.triggered. Um alerta dispara uma vez até a condição normalizar
 * (ver AlertConfigRepository) — não é lembrete diário.
 */
export class AlertService {
  constructor(
    private readonly products: ProductRepository,
    private readonly alerts: AlertConfigRepository,
  ) {}

  /** Chamado pelo job diário (alert-scheduler.ts) — varre todos os tenants. */
  async checkAllTenants(): Promise<void> {
    const tenantIds = await this.products.listActiveTenantIds();
    for (const tenantId of tenantIds) {
      await this.checkTenant(systemCtx(tenantId));
    }
  }

  async checkTenant(ctx: RequestContext): Promise<void> {
    const products = await this.products.listAllActive(ctx);
    for (const product of products) {
      await this.evaluateAlert(ctx, product, 'expiry', product.isNearExpiry);
      await this.evaluateAlert(ctx, product, 'low_stock', product.isLowStock);
    }
  }

  private async evaluateAlert(
    ctx: RequestContext,
    product: Product,
    alertType: AlertType,
    isTriggering: boolean,
  ): Promise<void> {
    const config = await this.alerts.findByProductAndType(ctx, product.id, alertType);
    const alreadyTriggered = config !== null && config.lastTriggeredAt !== null;

    if (isTriggering && !alreadyTriggered) {
      await this.alerts.markTriggered(ctx, product.id, alertType);
      await publishDomainEvent({
        name: EVENTS.ALERT_TRIGGERED,
        tenantId: ctx.tenantId,
        traceId: ctx.traceId,
        idempotencyKey: randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          productId: product.id,
          alertType,
          productName: product.name,
          ...(alertType === 'expiry' && product.expiryDate ? { expiryDate: product.expiryDate } : {}),
          ...(alertType === 'low_stock' ? { quantityInStock: product.quantityInStock } : {}),
        },
      });
      return;
    }

    if (!isTriggering && alreadyTriggered) {
      await this.alerts.clearTriggered(ctx, product.id, alertType);
    }
  }
}
