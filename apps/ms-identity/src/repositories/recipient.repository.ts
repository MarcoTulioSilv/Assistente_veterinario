import type { NotificationRecipient, UUID } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
}

function toRecipient(row: UserRow): NotificationRecipient {
  return { userId: row.id, email: row.email, phone: row.phone, emailVerified: row.emailVerifiedAt !== null };
}

const ACTIVE = { deletedAt: null, status: 'active' as const };
const SELECT = { id: true, email: true, phone: true, emailVerifiedAt: true } as const;

/**
 * Camada de acesso a dados — Dev 1 é o dono. Destinatários de notificação
 * (ADR-007): só usuários ativos e não excluídos, sempre sob withTenant (RLS).
 */
export class RecipientRepository {
  async byUser(tenantId: UUID, userId: UUID): Promise<NotificationRecipient | null> {
    const row = await withTenant(tenantId, (tx) => tx.user.findFirst({ where: { id: userId, ...ACTIVE }, select: SELECT }));
    return row ? toRecipient(row) : null;
  }

  /** Os eventos do MS3 trazem o id do veterinário; o aviso vai para o usuário dele. */
  async byVeterinarian(tenantId: UUID, veterinarianId: UUID): Promise<NotificationRecipient | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.veterinarian.findFirst({ where: { id: veterinarianId }, select: { user: { select: { ...SELECT, status: true, deletedAt: true } } } }),
    );
    const user = row?.user;
    if (!user || user.deletedAt !== null || user.status !== 'active') return null;
    return toRecipient(user);
  }

  /** Alerta de estoque é da clínica: vai para todos os administradores ativos. */
  async tenantAdmins(tenantId: UUID): Promise<NotificationRecipient[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.user.findMany({ where: { role: 'admin', ...ACTIVE }, select: SELECT, orderBy: { createdAt: 'asc' } }),
    );
    return rows.map(toRecipient);
  }
}
