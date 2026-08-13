import { describe, it, expect, vi, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { TOTP, Secret } from 'otpauth';
import { AuthService } from './auth.service';
import type { AuthRepository, AuthLookupRow, AuthUserRow } from '../repositories/auth.repository';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const EMAIL = 'dev@vetequine.com.br';
const PASSWORD = 'senha-correta-123';

let PASSWORD_HASH: string;
let TOTP_SECRET: string;

const baseLookupRow: () => AuthLookupRow = () => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  passwordHash: PASSWORD_HASH,
  role: 'admin',
  fullName: 'Usuário de Teste',
  totpSecret: null,
  totpEnabled: false,
  userStatus: 'active',
  tenantPlan: 'basic',
  tenantStatus: 'active',
});

const baseUserRow: (overrides?: Partial<AuthUserRow>) => AuthUserRow = (overrides) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  email: EMAIL,
  role: 'admin',
  fullName: 'Usuário de Teste',
  status: 'active',
  refreshTokenHash: null,
  refreshTokenExpiresAt: null,
  tenantPlan: 'basic',
  tenantStatus: 'active',
  ...overrides,
});

/** Fake escrito à mão — sem lib de mock de Prisma instalada no projeto. */
function fakeRepo(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    findAuthByEmail: vi.fn().mockResolvedValue(baseLookupRow()),
    findTenantIdForUser: vi.fn().mockResolvedValue(TENANT_ID),
    findById: vi.fn().mockResolvedValue(baseUserRow()),
    recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
    rotateRefreshToken: vi.fn().mockResolvedValue(undefined),
    clearRefreshToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthRepository;
}

beforeAll(() => {
  process.env['JWT_SECRET'] = 'test-secret-com-mais-de-32-caracteres-aqui';
  process.env['BCRYPT_ROUNDS'] = '4'; // rounds baixo só pra teste rodar rápido
  PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
  TOTP_SECRET = new Secret().base32;
});

function validTotpCode(): string {
  return new TOTP({ secret: Secret.fromBase32(TOTP_SECRET) }).generate();
}

describe('AuthService.login', () => {
  it('rejeita e-mail inexistente com mensagem genérica', async () => {
    const repo = fakeRepo({ findAuthByEmail: vi.fn().mockResolvedValue(null) });
    const service = new AuthService(repo);

    await expect(service.login('naoexiste@x.com', PASSWORD)).rejects.toThrow(/Credenciais inválidas/);
  });

  it('rejeita senha errada com a mesma mensagem genérica de e-mail inexistente', async () => {
    const repo = fakeRepo();
    const service = new AuthService(repo);

    await expect(service.login(EMAIL, 'senha-errada')).rejects.toThrow(/Credenciais inválidas/);
  });

  it('rejeita usuário com status inativo', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi.fn().mockResolvedValue({ ...baseLookupRow(), userStatus: 'inactive' }),
    });
    const service = new AuthService(repo);

    await expect(service.login(EMAIL, PASSWORD)).rejects.toThrow(/Conta inativa/);
  });

  it('rejeita tenant com status diferente de active', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi.fn().mockResolvedValue({ ...baseLookupRow(), tenantStatus: 'suspended' }),
    });
    const service = new AuthService(repo);

    await expect(service.login(EMAIL, PASSWORD)).rejects.toThrow(/Conta inativa/);
  });

  it('exige totpCode quando a conta tem 2FA habilitado', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi
        .fn()
        .mockResolvedValue({ ...baseLookupRow(), totpEnabled: true, totpSecret: TOTP_SECRET }),
    });
    const service = new AuthService(repo);

    await expect(service.login(EMAIL, PASSWORD)).rejects.toThrow(/Código TOTP obrigatório/);
  });

  it('rejeita totpCode incorreto', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi
        .fn()
        .mockResolvedValue({ ...baseLookupRow(), totpEnabled: true, totpSecret: TOTP_SECRET }),
    });
    const service = new AuthService(repo);

    await expect(service.login(EMAIL, PASSWORD, '000000')).rejects.toThrow(/Código TOTP inválido/);
  });

  it('aceita login com totpCode correto e retorna AuthTokens', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi
        .fn()
        .mockResolvedValue({ ...baseLookupRow(), totpEnabled: true, totpSecret: TOTP_SECRET }),
    });
    const service = new AuthService(repo);

    const result = await service.login(EMAIL, PASSWORD, validTotpCode());

    expect(result.user).toEqual({
      id: USER_ID,
      email: EMAIL,
      fullName: 'Usuário de Teste',
      role: 'admin',
      plan: 'basic',
      tenantId: TENANT_ID,
    });
    expect(result.accessToken.split('.')).toHaveLength(3); // JWT bem formado
    expect(result.expiresIn).toBe(15 * 60);
  });

  it('login bem-sucedido grava apenas o hash do refresh token, nunca o token cru', async () => {
    const recordSuccessfulLogin = vi.fn().mockResolvedValue(undefined);
    const repo = fakeRepo({ recordSuccessfulLogin });
    const service = new AuthService(repo);

    const result = await service.login(EMAIL, PASSWORD);

    expect(recordSuccessfulLogin).toHaveBeenCalledTimes(1);
    const [, , storedHash] = recordSuccessfulLogin.mock.calls[0] as [string, string, string, Date];
    expect(storedHash).not.toBe(result.refreshToken);
    const secret = result.refreshToken.slice(result.refreshToken.indexOf('.') + 1);
    await expect(bcrypt.compare(secret, storedHash)).resolves.toBe(true);
  });
});

describe('AuthService.refresh', () => {
  it('rejeita token sem o separador "."', async () => {
    const service = new AuthService(fakeRepo());
    await expect(service.refresh('token-sem-ponto')).rejects.toThrow(/Refresh token inválido/);
  });

  it('rejeita quando o userId não é encontrado', async () => {
    const repo = fakeRepo({ findTenantIdForUser: vi.fn().mockResolvedValue(null) });
    const service = new AuthService(repo);

    await expect(service.refresh(`${USER_ID}.qualquer-segredo`)).rejects.toThrow(/Sessão inválida/);
  });

  it('rejeita quando não há refreshTokenHash salvo (nunca fez login ou já deslogou)', async () => {
    const repo = fakeRepo({ findById: vi.fn().mockResolvedValue(baseUserRow({ refreshTokenHash: null })) });
    const service = new AuthService(repo);

    await expect(service.refresh(`${USER_ID}.qualquer-segredo`)).rejects.toThrow(/Sessão expirada/);
  });

  it('rejeita refresh token expirado', async () => {
    const hash = await bcrypt.hash('segredo-valido', 4);
    const repo = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        baseUserRow({ refreshTokenHash: hash, refreshTokenExpiresAt: new Date(Date.now() - 1000) }),
      ),
    });
    const service = new AuthService(repo);

    await expect(service.refresh(`${USER_ID}.segredo-valido`)).rejects.toThrow(/Sessão expirada/);
  });

  it('rejeita quando o segredo não bate com o hash salvo', async () => {
    const hash = await bcrypt.hash('segredo-certo', 4);
    const repo = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        baseUserRow({ refreshTokenHash: hash, refreshTokenExpiresAt: new Date(Date.now() + 100_000) }),
      ),
    });
    const service = new AuthService(repo);

    await expect(service.refresh(`${USER_ID}.segredo-errado`)).rejects.toThrow(/Sessão inválida/);
  });

  it('sucesso rotaciona o refresh token (novo hash, novo token retornado)', async () => {
    const oldSecret = 'segredo-atual';
    const hash = await bcrypt.hash(oldSecret, 4);
    const rotateRefreshToken = vi.fn().mockResolvedValue(undefined);
    const repo = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        baseUserRow({ refreshTokenHash: hash, refreshTokenExpiresAt: new Date(Date.now() + 100_000) }),
      ),
      rotateRefreshToken,
    });
    const service = new AuthService(repo);

    const result = await service.refresh(`${USER_ID}.${oldSecret}`);

    expect(rotateRefreshToken).toHaveBeenCalledTimes(1);
    expect(result.refreshToken).not.toBe(`${USER_ID}.${oldSecret}`);
    expect(result.user.email).toBe(EMAIL);
  });
});

describe('AuthService.logout', () => {
  it('é no-op silencioso quando o userId não é encontrado', async () => {
    const clearRefreshToken = vi.fn().mockResolvedValue(undefined);
    const repo = fakeRepo({ findTenantIdForUser: vi.fn().mockResolvedValue(null), clearRefreshToken });
    const service = new AuthService(repo);

    await expect(service.logout('id-desconhecido')).resolves.toBeUndefined();
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });

  it('limpa o refresh token do usuário quando encontrado', async () => {
    const clearRefreshToken = vi.fn().mockResolvedValue(undefined);
    const repo = fakeRepo({ clearRefreshToken });
    const service = new AuthService(repo);

    await service.logout(USER_ID);

    expect(clearRefreshToken).toHaveBeenCalledWith(TENANT_ID, USER_ID);
  });
});

describe('AuthService.verifyRefreshToken', () => {
  it('rejeita quando o segredo não bate (evita logout forçado só com o userId)', async () => {
    const hash = await bcrypt.hash('segredo-certo', 4);
    const repo = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        baseUserRow({ refreshTokenHash: hash, refreshTokenExpiresAt: new Date(Date.now() + 100_000) }),
      ),
    });
    const service = new AuthService(repo);

    await expect(service.verifyRefreshToken(`${USER_ID}.segredo-errado`)).rejects.toThrow(
      /Sessão inválida/,
    );
  });

  it('retorna o userId quando o segredo bate', async () => {
    const secret = 'segredo-certo';
    const hash = await bcrypt.hash(secret, 4);
    const repo = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        baseUserRow({ refreshTokenHash: hash, refreshTokenExpiresAt: new Date(Date.now() + 100_000) }),
      ),
    });
    const service = new AuthService(repo);

    await expect(service.verifyRefreshToken(`${USER_ID}.${secret}`)).resolves.toEqual({ userId: USER_ID });
  });
});
