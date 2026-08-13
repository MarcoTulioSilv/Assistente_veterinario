import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { TOTP, Secret } from 'otpauth';
import type { IAuthService, AuthTokens, UUID, UserRole, TenantPlan } from '@vetequine/shared-types';
import { AppError, getJwtSecret } from '@vetequine/shared-middlewares';
import type { AuthRepository, AuthLookupRow } from '../repositories/auth.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hash bcrypt de uma senha fixa e inexistente, gerado uma única vez.
 * Usado como alvo de comparação quando o e-mail não existe, para que
 * login() gaste tempo parecido tanto em "senha errada" quanto em
 * "e-mail não existe" — evita enumerar contas por timing.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy-password-timing-safety', bcryptRounds());

function bcryptRounds(): number {
  return parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10);
}

/** Converte strings tipo "15m"/"7d"/"30s" em milissegundos. */
function parseDurationMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input);
  if (!match) throw new Error(`Formato de duração inválido: "${input}"`);
  const value = Number(match[1]);
  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[match[2] as string]!;
}

interface RefreshTokenParts {
  userId: string;
  secret: string;
}

/** Refresh token opaco: "<userId>.<segredo>". userId é o seletor
 *  (não-secreto, só localiza o registro); segredo é a prova de posse. */
function parseRefreshToken(token: string): RefreshTokenParts {
  const dot = token.indexOf('.');
  if (dot === -1) throw AppError.unauthorized('Refresh token inválido');
  const userId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(userId) || secret.length === 0) {
    throw AppError.unauthorized('Refresh token inválido');
  }
  return { userId, secret };
}

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IAuthService publicada em shared-types.
 */
export class AuthService implements IAuthService {
  constructor(private readonly repo: AuthRepository) {}

  async login(email: string, password: string, totpCode?: string): Promise<AuthTokens> {
    const row = await this.repo.findAuthByEmail(email);

    const passwordOk = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_BCRYPT_HASH);
    if (!row || !passwordOk) {
      throw AppError.unauthorized('Credenciais inválidas');
    }
    if (row.userStatus !== 'active' || row.tenantStatus !== 'active') {
      throw AppError.unauthorized('Conta inativa');
    }
    if (row.totpEnabled) {
      this.assertValidTotp(row.totpSecret, totpCode);
    }

    const tokens = await this.issueTokens({
      id: row.id,
      tenantId: row.tenantId,
      role: row.role,
      plan: row.tenantPlan,
    });

    const refreshTokenHash = await this.hashRefreshSecret(tokens.refreshToken);
    await this.repo.recordSuccessfulLogin(
      row.tenantId,
      row.id,
      refreshTokenHash,
      this.refreshExpiresAt(),
    );

    return {
      ...tokens,
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
    const { userId, tenantId, user } = await this.resolveRefreshToken(refreshToken);

    const tokens = await this.issueTokens({
      id: userId,
      tenantId,
      role: user.role,
      plan: user.tenantPlan,
    });
    const refreshTokenHash = await this.hashRefreshSecret(tokens.refreshToken);
    await this.repo.rotateRefreshToken(tenantId, userId, refreshTokenHash, this.refreshExpiresAt());

    return {
      ...tokens,
      user: {
        id: userId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plan: user.tenantPlan,
        tenantId,
      },
    };
  }

  async logout(userId: UUID): Promise<void> {
    const tenantId = await this.repo.findTenantIdForUser(userId);
    if (!tenantId) return;
    await this.repo.clearRefreshToken(tenantId, userId);
  }

  /**
   * Resolve e valida a posse de um refresh token — usado pelo controller
   * de /auth/logout, já que IAuthService.logout(userId) não recebe o
   * token em si (não dá pra verificar o segredo dentro dele).
   */
  async verifyRefreshToken(refreshToken: string): Promise<{ userId: UUID }> {
    const { userId } = await this.resolveRefreshToken(refreshToken);
    return { userId };
  }

  // ─── Internos ─────────────────────────────────────────────────────

  private assertValidTotp(secret: string | null, code: string | undefined): void {
    if (!code) {
      throw AppError.validation('Código TOTP obrigatório', [
        { field: 'totpCode', message: 'obrigatório para esta conta' },
      ]);
    }
    if (!secret) {
      throw AppError.unauthorized('Conta com 2FA mal configurada');
    }
    const totp = new TOTP({ secret: Secret.fromBase32(secret) });
    if (totp.validate({ token: code, window: 1 }) === null) {
      throw AppError.unauthorized('Código TOTP inválido');
    }
  }

  private async resolveRefreshToken(refreshToken: string): Promise<{
    userId: string;
    tenantId: string;
    user: { role: UserRole; fullName: string; email: string; tenantPlan: TenantPlan };
  }> {
    const { userId, secret } = parseRefreshToken(refreshToken);

    const tenantId = await this.repo.findTenantIdForUser(userId);
    if (!tenantId) throw AppError.unauthorized('Sessão inválida');

    const user = await this.repo.findById(tenantId, userId);
    if (!user || user.status !== 'active' || user.tenantStatus !== 'active') {
      throw AppError.unauthorized('Sessão inválida');
    }
    if (!user.refreshTokenHash || !user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
      throw AppError.unauthorized('Sessão expirada');
    }
    const secretOk = await bcrypt.compare(secret, user.refreshTokenHash);
    if (!secretOk) {
      throw AppError.unauthorized('Sessão inválida');
    }

    return { userId, tenantId, user };
  }

  private async issueTokens(user: {
    id: string;
    tenantId: string;
    role: UserRole;
    plan: TenantPlan;
  }): Promise<IssuedTokens> {
    const accessExpiry = process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m';
    const accessToken = await new SignJWT({ tid: user.tenantId, role: user.role, plan: user.plan })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(accessExpiry)
      .sign(getJwtSecret());

    const secret = randomBytes(32).toString('base64url');
    const refreshToken = `${user.id}.${secret}`;

    return { accessToken, refreshToken, expiresIn: Math.floor(parseDurationMs(accessExpiry) / 1000) };
  }

  private async hashRefreshSecret(refreshToken: string): Promise<string> {
    const secret = refreshToken.slice(refreshToken.indexOf('.') + 1);
    return bcrypt.hash(secret, bcryptRounds());
  }

  private refreshExpiresAt(): Date {
    const refreshExpiry = process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d';
    return new Date(Date.now() + parseDurationMs(refreshExpiry));
  }
}

// Reexportado só para o teste unitário poder validar o shape sem duplicar o tipo.
export type { AuthLookupRow };
