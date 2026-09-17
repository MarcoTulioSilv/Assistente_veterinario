import type { AlertType } from '../../node_modules/.prisma/client-inventory';
import type { RequestContext, UUID } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Estado interno do AlertService (RF-EST-004/005): rastreia se um alerta
 * já foi disparado pra um produto, pra não duplicar enquanto a condição
 * não normaliza. Sem CRUD/HTTP nesta fatia — ver plano.
 */
export class AlertConfigRepository {
  async findByProductAndType(
    ctx: RequestContext,
    productId: UUID,
    alertType: AlertType,
  ): Promise<{ id: UUID; lastTriggeredAt: Date | null } | null> {
    return withTenant(ctx.tenantId, (tx) =>
      tx.alertConfig.findUnique({
        where: { productId_alertType: { productId, alertType } },
        select: { id: true, lastTriggeredAt: true },
      }),
    );
  }

  /** Marca como disparado agora — upsert porque a linha pode não existir ainda. */
  async markTriggered(ctx: RequestContext, productId: UUID, alertType: AlertType): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.alertConfig.upsert({
        where: { productId_alertType: { productId, alertType } },
        create: { tenantId: ctx.tenantId, productId, alertType, lastTriggeredAt: new Date() },
        update: { lastTriggeredAt: new Date() },
      }),
    );
  }

  /** Reseta pra permitir um novo disparo se a condição piorar de novo no futuro. */
  async clearTriggered(ctx: RequestContext, productId: UUID, alertType: AlertType): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.alertConfig.update({
        where: { productId_alertType: { productId, alertType } },
        data: { lastTriggeredAt: null },
      }),
    );
  }
}
