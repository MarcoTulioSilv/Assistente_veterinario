import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { TOTP, Secret } from 'otpauth';
import type { IAuthService, AuthTokens, UserRole, TenantPlan } from '@quironequine/shared-types';
import { AppError, createServiceLogger, getJwtSecret } from '@quironequine/shared-middlewares';
import { LOCK_THRESHOLD, type AuthRepository, type AuthLookupRow } from '../repositories/auth.repository';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../lib/password';

const log = createServiceLogger('auth-service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Janela em que um refresh token recém-rotacionado ainda é aceito: duas
 * abas renovando juntas, ou a resposta do refresh que se perdeu na rede e o
 * app tenta de novo. Fora dela, reapresentar o token é tratado como roubo.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/**
 * Resposta única para toda falha de login depois do formulário (auditoria
 * M-02): e-mail inexistente, senha errada, conta bloqueada, conta ou clínica
 * inativa e código TOTP errado. Mensagens diferentes contavam a um atacante
 * que a senha estava certa ou que a conta existia.
 */
export const LOGIN_FAILED_MESSAGE =
  'Credenciais inválidas. Depois de várias tentativas seguidas, a conta fica bloqueada por alguns minutos.';

/** Converte strings tipo "15m"/"7d"/"30s" em milissegundos. */
function parseDurationMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input);
  if (!match) throw new Error(`Formato de duração inválido: "${input}"`);
  const value = Number(match[1]);
  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[match[2] as string]!;
}

/** Vida da sessão de um aparelho (refresh token e o cookie que o carrega). */
export function refreshTokenTtlMs(): number {
  return parseDurationMs(process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d');
}

interface RefreshTokenParts {
  sessionId: string;
  secret: string;
}

/** Refresh token opaco: "<sessionId>.<segredo>". O id da sessão é o
 *  seletor (não-secreto, só localiza a linha); o segredo é a prova de posse. */
function parseRefreshToken(token: string): RefreshTokenParts | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(sessionId) || secret.length === 0) return null;
  return { sessionId, secret };
}

/**
 * SHA-256 do segredo do refresh (auditoria, M-04). São 32 bytes aleatórios,
 * não uma senha: não há dicionário a atrasar, e bcrypt ali custava ~300 ms
 * de CPU a cada renovação, de cada usuário, a cada 15 minutos.
 */
export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

interface NewCredentials {
  sessionId: string;
  refreshToken: string;
  secretHash: string;
}

function newCredentials(): NewCredentials {
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  return { sessionId, refreshToken: `${sessionId}.${secret}`, secretHash: hashRefreshSecret(secret) };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IAuthService publicada em shared-types.
 *
 * Sessão por aparelho (auditoria de 06/11/2026, A-03): cada login abre uma
 * linha em `user_sessions`, cada refresh troca a linha pela próxima da
 * mesma família, e o logout revoga só a deste aparelho.
 */
export class AuthService implements IAuthService {
  constructor(private readonly repo: AuthRepository) {}

  async login(email: string, password: string, totpCode?: string): Promise<AuthTokens> {
    const row = await this.repo.findAuthByEmail(email);
    const locked = !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now();

    // Sem conta, ou bloqueada: compara com um hash fictício e responde igual a
    // uma senha errada, no mesmo tempo (não revela se a conta existe nem dá
    // ao atacante como seguir testando senhas durante o bloqueio).
    const check = await verifyPassword(password, row && !locked ? row.passwordHash : await dummyPasswordHash());
    if (!row || locked) throw AppError.unauthorized(LOGIN_FAILED_MESSAGE);
    if (!check.ok) {
      await this.registerFailure(row);
      throw AppError.unauthorized(LOGIN_FAILED_MESSAGE);
    }
    if (row.userStatus !== 'active' || row.tenantStatus !== 'active') {
      // Senha certa: não conta como falha, mas a resposta é a mesma.
      log.info({ tenantId: row.tenantId, userId: row.id }, 'Login recusado: usuário ou clínica inativos');
      throw AppError.unauthorized(LOGIN_FAILED_MESSAGE);
    }
    if (row.totpEnabled) {
      await this.assertValidTotp(row, totpCode);
    }

    // Senha certa num hash antigo (bcrypt): o hash scrypt entra junto com a sessão.
    const newHash = check.needsRehash ? await hashPassword(password) : undefined;

    const credentials = newCredentials();
    await this.repo.startSession(
      row.tenantId,
      row.id,
      { id: credentials.sessionId, secretHash: credentials.secretHash, expiresAt: this.refreshExpiresAt() },
      { passwordHash: newHash },
    );

    return {
      ...(await this.issueAccessToken({ id: row.id, tenantId: row.tenantId, role: row.role, plan: row.tenantPlan })),
      refreshToken: credentials.refreshToken,
      user: {
        id: row.id,
        email,
        fullName: row.fullName,
        role: row.role,
        plan: row.tenantPlan,
        tenantId: row.tenantId,
      },
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const parts = parseRefreshToken(refreshToken);
    if (!parts) throw AppError.unauthorized('Refresh token inválido');

    const tenantId = await this.repo.findTenantIdForSession(parts.sessionId);
    if (!tenantId) throw AppError.unauthorized('Sessão inválida');

    const next = newCredentials();
    const result = await this.repo.rotateSession(tenantId, {
      sessionId: parts.sessionId,
      secretHash: hashRefreshSecret(parts.secret),
      next: { id: next.sessionId, secretHash: next.secretHash, expiresAt: this.refreshExpiresAt() },
      graceMs: REFRESH_REUSE_GRACE_MS,
    });

    switch (result.outcome) {
      case 'rotated':
      case 'grace': {
        const { user } = result;
        return {
          ...(await this.issueAccessToken({ id: user.id, tenantId, role: user.role, plan: user.tenantPlan })),
          refreshToken: next.refreshToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            plan: user.tenantPlan,
            tenantId,
          },
        };
      }
      case 'reuse':
        log.warn(
          { tenantId, userId: result.userId, sessionId: parts.sessionId },
          'Refresh token reutilizado fora da tolerância — sessão do aparelho revogada',
        );
        throw AppError.unauthorized('Sessão encerrada por segurança. Entre de novo.');
      case 'expired':
        throw AppError.unauthorized('Sessão expirada');
      default:
        throw AppError.unauthorized('Sessão inválida');
    }
  }

  /**
   * Revoga a sessão deste aparelho. Idempotente e silencioso: token
   * malformado, de sessão inexistente ou já revogada não é erro — o
   * aparelho sai de qualquer jeito, e a resposta não confirma nada a quem
   * tenta adivinhar.
   */
  async logout(refreshToken: string): Promise<void> {
    const parts = parseRefreshToken(refreshToken);
    if (!parts) return;
    const tenantId = await this.repo.findTenantIdForSession(parts.sessionId);
    if (!tenantId) return;
    await this.repo.revokeSession(tenantId, parts.sessionId, hashRefreshSecret(parts.secret));
  }

  // ─── Internos ─────────────────────────────────────────────────────

  private async registerFailure(row: AuthLookupRow): Promise<void> {
    const { failedLoginCount, lockedUntil } = await this.repo.registerLoginFailure(row.tenantId, row.id);
    if (lockedUntil && failedLoginCount >= LOCK_THRESHOLD) {
      log.warn(
        { tenantId: row.tenantId, userId: row.id, failedLoginCount, lockedUntil },
        'Conta bloqueada por falhas seguidas de login',
      );
    }
  }

  /**
   * 2FA (M-02). Só roda depois da senha certa, então o pedido do código pode
   * ser específico; o código errado, não. Código errado conta no mesmo
   * bloqueio da senha, e o passo de tempo aceito é reservado: o mesmo código
   * (ou um mais antigo da janela) não entra de novo.
   */
  private async assertValidTotp(row: AuthLookupRow, code: string | undefined): Promise<void> {
    if (!code) {
      throw AppError.validation('Código TOTP obrigatório', [
        { field: 'totpCode', message: 'obrigatório para esta conta' },
      ]);
    }
    if (!row.totpSecret) {
      log.error({ tenantId: row.tenantId, userId: row.id }, 'Conta com 2FA ligado e sem segredo TOTP');
      throw AppError.unauthorized(LOGIN_FAILED_MESSAGE);
    }

    const totp = new TOTP({ secret: Secret.fromBase32(row.totpSecret) });
    const delta = totp.validate({ token: code, window: 1 });
    const step = delta === null ? null : totp.counter() + delta;
    const fresh = step !== null && (row.totpLastStep === null || step > row.totpLastStep);
    if (step === null || !fresh || !(await this.repo.claimTotpStep(row.tenantId, row.id, step))) {
      await this.registerFailure(row);
      throw AppError.unauthorized(LOGIN_FAILED_MESSAGE);
    }
  }

  private async issueAccessToken(user: {
    id: string;
    tenantId: string;
    role: UserRole;
    plan: TenantPlan;
  }): Promise<{ accessToken: string; expiresIn: number }> {
    const accessExpiry = process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m';
    const accessToken = await new SignJWT({ tid: user.tenantId, role: user.role, plan: user.plan })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(accessExpiry)
      .sign(getJwtSecret());

    return { accessToken, expiresIn: Math.floor(parseDurationMs(accessExpiry) / 1000) };
  }

  private refreshExpiresAt(): Date {
    return new Date(Date.now() + refreshTokenTtlMs());
  }
}

// Reexportado só para o teste unitário poder validar o shape sem duplicar o tipo.
export type { AuthLookupRow };
