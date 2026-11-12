import { writeAudit } from '@quironequine/shared-middlewares';
import { prisma, withTenant } from '../prisma';

export type TokenPurpose = 'verify_email' | 'reset_password';

/** Token achado pelo hash, antes de saber o tenant (função SECURITY DEFINER). */
export interface TokenLookup {
  id: string;
  tenantId: string;
  userId: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
}

interface TokenLookupSql {
  id: string;
  tenant_id: string;
  user_id: string;
  purpose: TokenPurpose;
  expires_at: Date;
  used_at: Date | null;
}

export interface AccountUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  active: boolean;
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Tokens de conta (confirmação de
 * e-mail e recuperação de senha, auditoria M-02).
 *
 * O consumo do token é um UPDATE condicional (não usado e não vencido): dois
 * cliques no mesmo link ao mesmo tempo não passam os dois.
 */
export class AccountRepository {
  async findUser(tenantId: string, userId: string): Promise<AccountUser | null> {
    const row = await withTenant(tenantId, (tx) => tx.user.findFirst({ where: { id: userId, deletedAt: null } }));
    return row ? { id: row.id, email: row.email, emailVerifiedAt: row.emailVerifiedAt, active: row.status === 'active' } : null;
  }

  /** Quando foi emitido o último token deste tipo para o usuário (limite de reenvio). */
  async lastTokenCreatedAt(tenantId: string, userId: string, purpose: TokenPurpose): Promise<Date | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.userToken.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    );
    return row?.createdAt ?? null;
  }

  /**
   * Emite um token novo e inutiliza os anteriores do mesmo tipo ainda não
   * usados — só o link mais recente vale.
   */
  async createToken(
    tenantId: string,
    userId: string,
    purpose: TokenPurpose,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      await tx.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
      // created_at com o relógio da aplicação, o mesmo de used_at e do limite
      // de reenvio: misturar com o now() do banco quebraria as comparações.
      await tx.userToken.create({ data: { tenantId, userId, purpose, tokenHash, expiresAt, createdAt: now } });
    });
  }

  /** O token chega antes do login: a função SECURITY DEFINER acha o tenant (ADR-004). */
  async findToken(tokenHash: string): Promise<TokenLookup | null> {
    const rows = await prisma.$queryRaw<TokenLookupSql[]>`SELECT * FROM auth_find_user_token(${tokenHash})`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          purpose: row.purpose,
          expiresAt: row.expires_at,
          usedAt: row.used_at,
        }
      : null;
  }

  /** Confirma o e-mail. `false` se o token já foi usado ou venceu nesse meio-tempo. */
  async consumeVerifyToken(token: TokenLookup, now: Date): Promise<boolean> {
    return withTenant(token.tenantId, async (tx) => {
      const { count } = await tx.userToken.updateMany({
        where: { id: token.id, purpose: 'verify_email', usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now } });
      await writeAudit(tx, { tenantId: token.tenantId, userId: token.userId }, {
        action: 'update',
        table: 'users',
        recordId: token.userId,
        fields: ['emailVerifiedAt'],
      });
      return true;
    });
  }

  /**
   * Troca a senha pelo token de recuperação: grava o hash novo, zera o
   * bloqueio de login e encerra as sessões de TODOS os aparelhos (quem roubou
   * a senha antiga perde o acesso). Tudo numa transação.
   */
  async consumeResetToken(token: TokenLookup, passwordHash: string, now: Date): Promise<boolean> {
    return withTenant(token.tenantId, async (tx) => {
      const { count } = await tx.userToken.updateMany({
        where: { id: token.id, purpose: 'reset_password', usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.userSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_reset' },
      });
      await writeAudit(tx, { tenantId: token.tenantId, userId: token.userId }, {
        action: 'update',
        table: 'users',
        recordId: token.userId,
        fields: ['passwordHash'],
      });
      return true;
    });
  }
}
