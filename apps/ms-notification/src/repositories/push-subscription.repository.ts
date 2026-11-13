import type { RequestContext, UUID, PushSubscriptionDto } from '@quironequine/shared-types';
import { writeAudit } from '@quironequine/shared-middlewares';
import { withTenant } from '../prisma';

export interface ActiveSubscription {
  id: UUID;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const TABLE = 'push_subscriptions';

/**
 * Camada de acesso a dados — Dev 1 é o dono. Aparelhos que aceitaram push.
 *
 * O endpoint identifica o navegador. Assinar de novo o mesmo endpoint na
 * mesma clínica passa a assinatura para quem está logado agora (aparelho
 * compartilhado). Sair do sistema deve cancelar a assinatura (PWA).
 */
export class PushSubscriptionRepository {
  async upsert(ctx: RequestContext, subscription: PushSubscriptionDto): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.pushSubscription.upsert({
        where: { tenantId_endpoint: { tenantId: ctx.tenantId, endpoint: subscription.endpoint } },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        update: {
          userId: ctx.userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          revokedAt: null,
        },
      });
      await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
        action: 'update',
        table: TABLE,
        recordId: row.id,
        fields: ['endpoint', 'keys'],
      });
    });
  }

  /** Cancela a assinatura do PRÓPRIO usuário. Idempotente. */
  async revokeOwn(ctx: RequestContext, endpoint: string, at: Date): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.pushSubscription.findFirst({
        where: { endpoint, userId: ctx.userId, revokedAt: null },
      });
      if (!row) return;
      await tx.pushSubscription.update({ where: { id: row.id }, data: { revokedAt: at } });
      await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
        action: 'cancel',
        table: TABLE,
        recordId: row.id,
      });
    });
  }

  async listActive(tenantId: UUID, userId: UUID): Promise<ActiveSubscription[]> {
    return withTenant(tenantId, (tx) =>
      tx.pushSubscription.findMany({
        where: { userId, revokedAt: null },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      }),
    );
  }

  /** O serviço de push disse que a assinatura não existe mais (404/410). */
  async revokeGone(tenantId: UUID, id: UUID, at: Date): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.pushSubscription.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } }),
    );
  }
}
