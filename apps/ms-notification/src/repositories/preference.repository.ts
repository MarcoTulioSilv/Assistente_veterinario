import type {
  RequestContext,
  UUID,
  NotificationPreference,
  NotificationType,
  NotificationChannel,
} from '@quironequine/shared-types';
import { writeAudit } from '@quironequine/shared-middlewares';
import { withTenant } from '../prisma';

/**
 * Camada de acesso a dados — Dev 1 é o dono. Preferências por tipo e canal
 * (RF-NOT-003). Só as desligadas importam: sem linha = ligado.
 */
export class PreferenceRepository {
  async listForUser(tenantId: UUID, userId: UUID): Promise<NotificationPreference[]> {
    const rows = await withTenant(tenantId, (tx) => tx.notificationPreference.findMany({ where: { userId } }));
    return rows.map((r) => ({ type: r.type, channel: r.channel, enabled: r.enabled }));
  }

  async isEnabled(tenantId: UUID, userId: UUID, type: NotificationType, channel: NotificationChannel): Promise<boolean> {
    const row = await withTenant(tenantId, (tx) =>
      tx.notificationPreference.findUnique({
        where: { tenantId_userId_type_channel: { tenantId, userId, type, channel } },
      }),
    );
    return row?.enabled ?? true;
  }

  async upsertMany(ctx: RequestContext, preferences: NotificationPreference[]): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      for (const p of preferences) {
        const row = await tx.notificationPreference.upsert({
          where: {
            tenantId_userId_type_channel: { tenantId: ctx.tenantId, userId: ctx.userId, type: p.type, channel: p.channel },
          },
          create: { tenantId: ctx.tenantId, userId: ctx.userId, type: p.type, channel: p.channel, enabled: p.enabled },
          update: { enabled: p.enabled },
        });
        await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
          action: 'update',
          table: 'notification_preferences',
          recordId: row.id,
          fields: ['enabled'],
        });
      }
    });
  }
}
