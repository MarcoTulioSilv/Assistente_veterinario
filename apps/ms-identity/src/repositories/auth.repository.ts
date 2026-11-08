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
  /** Bloqueio progressivo (M-02): falhas seguidas e até quando a conta está bloqueada. */
  failedLoginCount: number;
  lockedUntil: Date | null;
  /** Último passo de TOTP aceito (M-02): impede reusar o mesmo código. */
  totpLastStep: number | null;
}

/**
 * Bloqueio progressivo (auditoria M-02): a partir da LOCK_THRESHOLD-ésima
 * falha seguida, a conta fica bloqueada por 1, 2, 4... minutos, até
 * MAX_LOCK_MINUTES. O teto baixo é de propósito: quem sabe o e-mail de
 * alguém não consegue deixar a conta da pessoa travada por muito tempo, e o
 * limite por IP do BFF segura o volume.
 */
export const LOCK_THRESHOLD = 5;
export const MAX_LOCK_MINUTES = 15;

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
  failed_login_count: number;
  locked_until: Date | null;
  totp_last_step: bigint | null;
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
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until,
      totpLastStep: row.totp_last_step === null ? null : Number(row.totp_last_step),
    };
  }

  async findTenantIdForSession(sessionId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ auth_tenant_id_for_session: string | null }>>`
      SELECT auth_tenant_id_for_session(${sessionId}::uuid)
    `;
    return rows[0]?.auth_tenant_id_for_session ?? null;
  }

  /**
   * Login: abre a sessão do aparelho (família nova), marca o último acesso e
   * zera o contador de falhas. `passwordHash` vem quando a senha certa estava
   * num hash antigo (bcrypt): o hash novo entra na mesma transação.
   */
  async startSession(
    tenantId: string,
    userId: string,
    session: NewSession,
    extra: { passwordHash?: string } = {},
  ): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      await tx.userSession.create({
        data: { ...session, tenantId, userId, familyId: session.id },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          ...(extra.passwordHash ? { passwordHash: extra.passwordHash } : {}),
        },
      });
    });
  }

  /**
   * Conta uma falha de login (senha ou TOTP) e, a partir da LOCK_THRESHOLD-ésima
   * seguida, bloqueia. Num UPDATE só, para que tentativas simultâneas não
   * percam contagem. Devolve o total de falhas e o fim do bloqueio.
   */
  async registerLoginFailure(
    tenantId: string,
    userId: string,
  ): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ failed_login_count: number; locked_until: Date | null }>>`
        UPDATE users
           SET failed_login_count = failed_login_count + 1,
               locked_until = CASE
                 WHEN failed_login_count + 1 >= ${LOCK_THRESHOLD}::int
                 -- LEAST antes do ::int: com muitas falhas, 2^n estouraria o inteiro.
                 THEN now() + make_interval(mins => LEAST(${MAX_LOCK_MINUTES}::float8, power(2, failed_login_count + 1 - ${LOCK_THRESHOLD}::int))::int)
                 ELSE locked_until
               END
         WHERE id = ${userId}::uuid
         RETURNING failed_login_count, locked_until`;
      const row = rows[0];
      return { failedLoginCount: row?.failed_login_count ?? 0, lockedUntil: row?.locked_until ?? null };
    });
  }

  /**
   * Reserva o passo de TOTP do código aceito: só passa se for maior que o
   * último reservado. Condicional e atômico — dois logins com o mesmo código
   * ao mesmo tempo não passam os dois. `false` = código já usado.
   */
  async claimTotpStep(tenantId: string, userId: string, step: number): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
        data: { totpLastStep: BigInt(step) },
      });
      return count === 1;
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
