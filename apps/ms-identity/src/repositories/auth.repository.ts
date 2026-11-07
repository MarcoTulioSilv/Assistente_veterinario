import type { UserRole, TenantPlan } from '@quironequine/shared-types';
import { prisma, withTenant } from '../prisma';

export interface AuthLookupRow {
  id: string;
  tenantId: string;
  passwordHash: string;
  role: UserRole;
  fullName: string;
  totpSecret: string | null;
  totpEnabled: boolean;
  userStatus: 'active' | 'inactive';
  tenantPlan: TenantPlan;
  tenantStatus: 'active' | 'suspended' | 'cancelled';
}

/** O que o refresh precisa do usuário para emitir o access token novo. */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantPlan: TenantPlan;
}

/** Sessão nova: o segredo chega já como SHA-256 — o cru nunca passa daqui. */
export interface NewSession {
  id: string;
  secretHash: string;
  expiresAt: Date;
}

/**
 * Resultado da rotação:
 * - `rotated`: o token era o vigente; virou o próximo da família;
 * - `grace`: o token acabou de ser rotacionado (duas abas, nova tentativa
 *   após timeout) — ganha uma sessão irmã em vez de derrubar o usuário;
 * - `reuse`: token rotacionado há mais tempo que a tolerância — a família
 *   inteira foi revogada (provável token roubado);
 * - `expired`, `revoked`, `invalid`, `inactive`: nada é emitido.
 */
export type RotationResult =
  | { outcome: 'rotated' | 'grace'; user: SessionUser }
  | { outcome: 'reuse'; userId: string }
  | { outcome: 'expired' | 'revoked' | 'invalid' | 'inactive' };

interface RawLookupRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  role: UserRole;
  full_name: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  user_status: 'active' | 'inactive';
  tenant_plan: TenantPlan;
  tenant_status: 'active' | 'suspended' | 'cancelled';
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 *
 * findAuthByEmail() e findTenantIdForSession() são a ÚNICA exceção a
 * "toda leitura passa por withTenant()" no código-base — ver ADR-004.
 * Chamam funções SECURITY DEFINER, nunca SELECT direto; a partir do momento
 * em que o tenantId é conhecido, todo o resto volta ao caminho normal via
 * withTenant(), com RLS.
 */
export class AuthRepository {
  async findAuthByEmail(email: string): Promise<AuthLookupRow | null> {
    const rows = await prisma.$queryRaw<RawLookupRow[]>`
      SELECT * FROM auth_lookup_by_email(${email})
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      passwordHash: row.password_hash,
      role: row.role,
      fullName: row.full_name,
      totpSecret: row.totp_secret,
      totpEnabled: row.totp_enabled,
      userStatus: row.user_status,
      tenantPlan: row.tenant_plan,
      tenantStatus: row.tenant_status,
    };
  }

  async findTenantIdForSession(sessionId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ auth_tenant_id_for_session: string | null }>>`
      SELECT auth_tenant_id_for_session(${sessionId}::uuid)
    `;
    return rows[0]?.auth_tenant_id_for_session ?? null;
  }

  /** Login: abre a sessão do aparelho (família nova) e marca o último acesso. */
  async startSession(tenantId: string, userId: string, session: NewSession): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      await tx.userSession.create({
        data: { ...session, tenantId, userId, familyId: session.id },
      });
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    });
  }

  /**
   * Troca a sessão `sessionId` pela `next`, numa transação. O UPDATE
   * condicional é o que torna a rotação atômica: de duas chamadas
   * simultâneas com o mesmo token, só uma revoga a linha vigente; a outra
   * encontra a linha já rotacionada e cai na tolerância (`graceMs`).
   */
  async rotateSession(
    tenantId: string,
    input: { sessionId: string; secretHash: string; next: NewSession; graceMs: number },
  ): Promise<RotationResult> {
    return withTenant(tenantId, async (tx) => {
      const now = new Date();
      const { count } = await tx.userSession.updateMany({
        where: { id: input.sessionId, secretHash: input.secretHash, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now, rotatedAt: now, revokedReason: 'rotated' },
      });

      const current = await tx.userSession.findFirst({
        where: { id: input.sessionId, secretHash: input.secretHash },
      });
      if (!current) return { outcome: 'invalid' };

      if (count === 0) {
        if (current.expiresAt <= now) return { outcome: 'expired' };
        if (current.revokedReason !== 'rotated' || !current.rotatedAt) return { outcome: 'revoked' };
        if (now.getTime() - current.rotatedAt.getTime() > input.graceMs) {
          await tx.userSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: now, revokedReason: 'reuse' },
          });
          return { outcome: 'reuse', userId: current.userId };
        }
      }

      // Usuário ou clínica desativados não renovam — a sessão vigente já
      // foi revogada acima e nenhuma nova é aberta.
      const user = await tx.user.findFirst({
        where: { id: current.userId, deletedAt: null },
        include: { tenant: true },
      });
      if (!user || user.status !== 'active' || user.tenant.status !== 'active') {
        return { outcome: 'inactive' };
      }

      await tx.userSession.create({
        data: { ...input.next, tenantId, userId: current.userId, familyId: current.familyId },
      });
      return {
        outcome: count === 1 ? 'rotated' : 'grace',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          tenantPlan: user.tenant.plan,
        },
      };
    });
  }

  /** Logout: revoga só a sessão deste aparelho, e só com o segredo certo. */
  async revokeSession(tenantId: string, sessionId: string, secretHash: string): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.userSession.updateMany({
        where: { id: sessionId, secretHash, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      }),
    );
  }
}
