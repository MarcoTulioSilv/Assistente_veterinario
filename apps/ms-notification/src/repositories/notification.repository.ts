import { Prisma } from '../../node_modules/.prisma/client-notification';
import type { Notification as NotificationRow } from '../../node_modules/.prisma/client-notification';
import type {
  RequestContext,
  UUID,
  Notification,
  NotificationData,
  NotificationTarget,
  NotificationType,
  NotificationChannel,
  Paginated,
} from '@quironequine/shared-types';
import { withTenant } from '../prisma';

/** NotificationData sem o `type` — o tipo fica na coluna própria. */
type StoredData = Record<string, unknown>;

export interface NewNotification {
  tenantId: UUID;
  userId: UUID;
  data: NotificationData;
  target: NotificationTarget | null;
  idempotencyKey: UUID;
}

export interface DeliveryRow {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  type: NotificationType;
  data: NotificationData;
  target: NotificationTarget | null;
}

function toData(row: NotificationRow): NotificationData {
  return { ...(row.data as StoredData), type: row.type } as NotificationData;
}

function toTarget(row: NotificationRow): NotificationTarget | null {
  return row.targetKind && row.targetId ? { kind: row.targetKind, id: row.targetId } : null;
}

export function toDomain(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    data: toData(row),
    target: toTarget(row),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Caixa de entrada e registro
 * das entregas. Toda query passa por withTenant() (RLS, ADR-001 §5.2); o
 * consumidor de eventos usa o tenant do envelope.
 *
 * A caixa de entrada não guarda dado pessoal (só tipo, ids, horários e
 * nomes de produto/vacina/exame), por isso não passa pelo audit_log.
 */
export class NotificationRepository {
  /**
   * Grava o item da caixa de entrada. `created: false` quando o mesmo evento
   * já tinha gerado o item para este usuário (redelivery do broker) — aí não
   * se entrega de novo.
   */
  async createIfAbsent(input: NewNotification): Promise<{ id: UUID; created: boolean }> {
    const { type, ...data } = input.data;
    try {
      const row = await withTenant(input.tenantId, (tx) =>
        tx.notification.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId,
            type,
            data: data as Prisma.InputJsonObject,
            targetKind: input.target?.kind ?? null,
            targetId: input.target?.id ?? null,
            idempotencyKey: input.idempotencyKey,
          },
        }),
      );
      return { id: row.id, created: true };
    } catch (err) {
      if (!isUniqueError(err)) throw err;
      const existing = await withTenant(input.tenantId, (tx) =>
        tx.notification.findUniqueOrThrow({
          where: {
            tenantId_userId_idempotencyKey: {
              tenantId: input.tenantId,
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        }),
      );
      return { id: existing.id, created: false };
    }
  }

  async list(
    ctx: RequestContext,
    page: number,
    limit: number,
    unreadOnly: boolean,
  ): Promise<Paginated<Notification>> {
    const where = { userId: ctx.userId, deletedAt: null, ...(unreadOnly ? { readAt: null } : {}) };
    const [rows, total] = await withTenant(ctx.tenantId, (tx) =>
      Promise.all([
        tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        tx.notification.count({ where }),
      ]),
    );
    return {
      data: rows.map(toDomain),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async unreadCount(ctx: RequestContext): Promise<number> {
    return withTenant(ctx.tenantId, (tx) =>
      tx.notification.count({ where: { userId: ctx.userId, deletedAt: null, readAt: null } }),
    );
  }

  /** `false` se a notificação não existe ou é de outro usuário. Ler de novo não é erro. */
  async markRead(ctx: RequestContext, id: UUID, at: Date): Promise<boolean> {
    return withTenant(ctx.tenantId, async (tx) => {
      const own = await tx.notification.findFirst({ where: { id, userId: ctx.userId, deletedAt: null } });
      if (!own) return false;
      if (!own.readAt) await tx.notification.update({ where: { id }, data: { readAt: at } });
      return true;
    });
  }

  async markAllRead(ctx: RequestContext, at: Date): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.notification.updateMany({ where: { userId: ctx.userId, readAt: null, deletedAt: null }, data: { readAt: at } }),
    );
  }

  async findForDelivery(tenantId: UUID, id: UUID): Promise<DeliveryRow | null> {
    const row = await withTenant(tenantId, (tx) => tx.notification.findFirst({ where: { id, deletedAt: null } }));
    return row
      ? { id: row.id, tenantId: row.tenantId, userId: row.userId, type: row.type, data: toData(row), target: toTarget(row) }
      : null;
  }

  async recordAttempt(
    tenantId: UUID,
    notificationId: UUID,
    channel: NotificationChannel,
    status: 'sent' | 'failed' | 'skipped',
    detail: string | null,
  ): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.deliveryAttempt.create({
        data: { tenantId, notificationId, channel, status, detail: detail?.slice(0, 500) ?? null },
      }),
    );
  }
}
