import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type { IAccountService, DomainEvent, AccountEmailPayload, UUID } from '@quironequine/shared-types';
import { AppError, createServiceLogger } from '@quironequine/shared-middlewares';
import type { AccountRepository, TokenPurpose, TokenLookup } from '../repositories/account.repository';
import { hashPassword } from '../lib/password';
import { publishAccountEmail } from '../events/publisher';

const log = createServiceLogger('account-service');

export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;
/** Intervalo mínimo entre dois e-mails do mesmo tipo para o mesmo usuário. */
export const RESEND_INTERVAL_MS = 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Chave do envio de e-mail da conta. Desligada (padrão) enquanto não houver
 * conta de e-mail (decisão de 12/11/2026): o cadastro segue sem confirmação e
 * a recuperação de senha não envia nada. Ligar exige o e-mail ligado também
 * no MS5 (EMAIL_ENABLED) — ver ADR-007.
 */
export function emailVerificationEnabled(): boolean {
  return process.env['EMAIL_VERIFICATION_ENABLED'] === 'true';
}

/** Só o SHA-256 vai para o banco; o token cru vai no link do e-mail. */
export function hashAccountToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVALID_LINK = 'Link inválido ou vencido. Peça um novo.';

function invalidLink(): AppError {
  return AppError.validation(INVALID_LINK, [{ field: 'token', message: INVALID_LINK }]);
}

const EVENT_BY_PURPOSE = {
  verify_email: EVENTS.AUTH_EMAIL_VERIFICATION_REQUESTED,
  reset_password: EVENTS.AUTH_PASSWORD_RESET_REQUESTED,
} as const;

const TTL_BY_PURPOSE: Record<TokenPurpose, number> = {
  verify_email: VERIFY_EMAIL_TTL_MS,
  reset_password: RESET_PASSWORD_TTL_MS,
};

/** Consulta mínima do login por e-mail (AuthRepository.findAuthByEmail). */
export interface AccountEmailLookup {
  findAuthByEmail(email: string): Promise<{ id: string; tenantId: string; userStatus: string; tenantStatus: string } | null>;
}

/**
 * Confirmação de e-mail e recuperação de senha (auditoria 06/11/2026, M-02)
 * — Dev 1 é o dono. O MS1 emite o token de uso único e publica um evento; o
 * MS5 envia o e-mail (ADR-007).
 */
export class AccountService implements IAccountService {
  constructor(
    private readonly repo: AccountRepository,
    private readonly lookup: AccountEmailLookup,
    private readonly publish: (event: DomainEvent<AccountEmailPayload>) => Promise<void> = publishAccountEmail,
    private readonly now: () => Date = () => new Date(),
    private readonly enabled: () => boolean = emailVerificationEnabled,
  ) {}

  /**
   * Cadastro novo: manda a confirmação, se o envio estiver ligado. Falha de
   * publicação não desfaz o cadastro — o usuário pede outro link.
   */
  async sendVerificationAfterSignup(tenantId: UUID, userId: UUID, email: string): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.issue(tenantId, userId, email, 'verify_email');
    } catch (err) {
      log.error({ err, tenantId, userId }, 'Cadastro feito, mas o e-mail de confirmação não foi publicado');
    }
  }

  /**
   * Reenvio público, por e-mail: quem não confirmou não consegue entrar para
   * pedir. Sempre termina igual — não revela se a conta existe, se já foi
   * confirmada ou se o pedido foi recente.
   */
  async requestEmailVerification(email: string): Promise<void> {
    if (!this.enabled()) return;
    const row = await this.lookup.findAuthByEmail(email);
    if (!row || row.userStatus !== 'active' || row.tenantStatus !== 'active') return;
    const user = await this.repo.findUser(row.tenantId, row.id);
    if (!user || user.emailVerifiedAt) return;
    if (await this.sentRecently(row.tenantId, row.id, 'verify_email')) return;
    try {
      await this.issue(row.tenantId, row.id, user.email, 'verify_email');
    } catch (err) {
      log.error({ err, tenantId: row.tenantId, userId: row.id }, 'Reenvio da confirmação não publicado');
    }
  }

  async confirmEmail(token: string): Promise<void> {
    const found = await this.validToken(token, 'verify_email');
    if (!(await this.repo.consumeVerifyToken(found, this.now()))) throw invalidLink();
  }

  /**
   * Sempre termina igual, exista a conta ou não, esteja o envio ligado ou
   * não: a resposta não pode revelar quem tem cadastro.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (!this.enabled()) return;
    const row = await this.lookup.findAuthByEmail(email);
    if (!row || row.userStatus !== 'active' || row.tenantStatus !== 'active') return;
    if (await this.sentRecently(row.tenantId, row.id, 'reset_password')) return;
    try {
      await this.issue(row.tenantId, row.id, email, 'reset_password');
    } catch (err) {
      log.error({ err, tenantId: row.tenantId, userId: row.id }, 'Pedido de nova senha não publicado');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw AppError.validation('Senha muito curta', [
        { field: 'newPassword', message: `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres` },
      ]);
    }
    const found = await this.validToken(token, 'reset_password');
    const passwordHash = await hashPassword(newPassword);
    if (!(await this.repo.consumeResetToken(found, passwordHash, this.now()))) throw invalidLink();
    log.info({ tenantId: found.tenantId, userId: found.userId }, 'Senha trocada por recuperação; sessões encerradas');
  }

  // ─── Internos ─────────────────────────────────────────────────────

  private async sentRecently(tenantId: UUID, userId: UUID, purpose: TokenPurpose): Promise<boolean> {
    const last = await this.repo.lastTokenCreatedAt(tenantId, userId, purpose);
    return last !== null && this.now().getTime() - last.getTime() < RESEND_INTERVAL_MS;
  }

  /** Token existente, do tipo certo, não usado e não vencido. */
  private async validToken(token: string, purpose: TokenPurpose): Promise<TokenLookup> {
    if (!token) throw invalidLink();
    const found = await this.repo.findToken(hashAccountToken(token));
    if (!found || found.purpose !== purpose || found.usedAt || found.expiresAt <= this.now()) throw invalidLink();
    return found;
  }

  private async issue(tenantId: UUID, userId: UUID, email: string, purpose: TokenPurpose): Promise<void> {
    const now = this.now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + TTL_BY_PURPOSE[purpose]);
    await this.repo.createToken(tenantId, userId, purpose, hashAccountToken(token), expiresAt, now);

    const id = randomUUID();
    await this.publish({
      name: EVENT_BY_PURPOSE[purpose],
      tenantId,
      traceId: `account-${id}`,
      idempotencyKey: id,
      occurredAt: now.toISOString(),
      payload: { userId, email, token, expiresAt: expiresAt.toISOString() },
    });
  }
}
