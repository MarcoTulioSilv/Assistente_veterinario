import { describe, it, expect, vi, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { TOTP, Secret } from 'otpauth';
import { AuthService, hashRefreshSecret, REFRESH_REUSE_GRACE_MS, EMAIL_NOT_VERIFIED_MESSAGE } from './auth.service';
import { hashPassword, verifyPassword } from '../lib/password';
import type { AuthRepository, AuthLookupRow, SessionUser } from '../repositories/auth.repository';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REFRESH = `${SESSION_ID}.segredo-do-aparelho`;
const EMAIL = 'dev@quironequine.com.br';
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
  failedLoginCount: 0,
  lockedUntil: null,
  totpLastStep: null,
});

const SESSION_USER: SessionUser = {
  id: USER_ID,
  email: EMAIL,
  fullName: 'Usuário de Teste',
  role: 'admin',
  tenantPlan: 'basic',
};

/** Fake escrito à mão — sem lib de mock de Prisma instalada no projeto. */
function fakeRepo(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    findAuthByEmail: vi.fn().mockResolvedValue(baseLookupRow()),
    findTenantIdForSession: vi.fn().mockResolvedValue(TENANT_ID),
    startSession: vi.fn().mockResolvedValue(undefined),
    rotateSession: vi.fn().mockResolvedValue({ outcome: 'rotated', user: SESSION_USER }),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    registerLoginFailure: vi.fn().mockResolvedValue({ failedLoginCount: 1, lockedUntil: null }),
    claimTotpStep: vi.fn().mockResolvedValue(true),
    isEmailVerified: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as AuthRepository;
}

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'test-secret-com-mais-de-32-caracteres-aqui';
  PASSWORD_HASH = await hashPassword(PASSWORD); // scrypt com os parâmetros atuais
  TOTP_SECRET = new Secret().base32;
});

function validTotpCode(): string {
  return new TOTP({ secret: Secret.fromBase32(TOTP_SECRET) }).generate();
}

describe('AuthService.login', () => {
  const INVALID = /Credenciais inválidas/;
  const withRow = (row: Partial<AuthLookupRow>) =>
    fakeRepo({ findAuthByEmail: vi.fn().mockResolvedValue({ ...baseLookupRow(), ...row }) });

  it('rejeita e-mail inexistente com mensagem genérica', async () => {
    const repo = fakeRepo({ findAuthByEmail: vi.fn().mockResolvedValue(null) });
    await expect(new AuthService(repo).login('naoexiste@x.com', PASSWORD)).rejects.toThrow(INVALID);
    expect(repo.registerLoginFailure).not.toHaveBeenCalled();
  });

  it('senha errada: mesma mensagem e conta uma falha (M-02)', async () => {
    const repo = fakeRepo();
    await expect(new AuthService(repo).login(EMAIL, 'senha-errada')).rejects.toThrow(INVALID);
    expect(repo.registerLoginFailure).toHaveBeenCalledWith(TENANT_ID, USER_ID);
    expect(repo.startSession).not.toHaveBeenCalled();
  });

  it('conta bloqueada: recusa mesmo com a senha certa, sem contar falha nova nem abrir sessão', async () => {
    const repo = withRow({ failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD)).rejects.toThrow(INVALID);
    expect(repo.registerLoginFailure).not.toHaveBeenCalled();
    expect(repo.startSession).not.toHaveBeenCalled();
  });

  it('bloqueio vencido: a senha certa entra de novo', async () => {
    const repo = withRow({ failedLoginCount: 5, lockedUntil: new Date(Date.now() - 1000) });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD)).resolves.toHaveProperty('accessToken');
    expect(repo.startSession).toHaveBeenCalled();
  });

  it.each([
    ['usuário inativo', { userStatus: 'inactive' as const }],
    ['clínica suspensa', { tenantStatus: 'suspended' as const }],
  ])('%s: mesma mensagem genérica, sem contar falha (a senha estava certa)', async (_caso, row) => {
    const repo = withRow(row);
    await expect(new AuthService(repo).login(EMAIL, PASSWORD)).rejects.toThrow(INVALID);
    expect(repo.registerLoginFailure).not.toHaveBeenCalled();
  });

  it('confirmação ligada: senha certa com e-mail não confirmado não entra (M-02)', async () => {
    const repo = fakeRepo({ isEmailVerified: vi.fn().mockResolvedValue(false) });
    await expect(new AuthService(repo, () => true).login(EMAIL, PASSWORD)).rejects.toMatchObject({
      statusCode: 403,
      message: EMAIL_NOT_VERIFIED_MESSAGE,
    });
    expect(repo.startSession).not.toHaveBeenCalled();
  });

  it('confirmação ligada: senha errada continua com a mensagem genérica, sem revelar o e-mail não confirmado', async () => {
    const repo = fakeRepo({ isEmailVerified: vi.fn().mockResolvedValue(false) });
    await expect(new AuthService(repo, () => true).login(EMAIL, 'senha-errada')).rejects.toThrow(INVALID);
    expect(repo.isEmailVerified).not.toHaveBeenCalled();
  });

  it('confirmação desligada (padrão): não consulta o e-mail confirmado', async () => {
    const repo = fakeRepo({ isEmailVerified: vi.fn().mockResolvedValue(false) });
    await new AuthService(repo, () => false).login(EMAIL, PASSWORD);
    expect(repo.isEmailVerified).not.toHaveBeenCalled();
  });

  it('exige totpCode quando a conta tem 2FA habilitado (só depois da senha certa)', async () => {
    const repo = withRow({ totpEnabled: true, totpSecret: TOTP_SECRET });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD)).rejects.toThrow(/Código TOTP obrigatório/);
  });

  it('totpCode incorreto: mensagem genérica e conta no mesmo bloqueio da senha', async () => {
    const repo = withRow({ totpEnabled: true, totpSecret: TOTP_SECRET });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD, '000000')).rejects.toThrow(INVALID);
    expect(repo.registerLoginFailure).toHaveBeenCalledWith(TENANT_ID, USER_ID);
  });

  it('aceita login com totpCode correto, reserva o passo e retorna AuthTokens', async () => {
    const repo = withRow({ totpEnabled: true, totpSecret: TOTP_SECRET });
    // Código e passo do MESMO instante: calcular o passo depois do login dava
    // um passo a mais quando a janela de 30 s virava no meio do teste (o
    // service reserva o passo do código, que é o certo).
    const totp = new TOTP({ secret: Secret.fromBase32(TOTP_SECRET) });
    const timestamp = Date.now();
    const step = totp.counter({ timestamp });
    const result = await new AuthService(repo).login(EMAIL, PASSWORD, totp.generate({ timestamp }));

    expect(repo.claimTotpStep).toHaveBeenCalledWith(TENANT_ID, USER_ID, step);
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

  it('código TOTP já usado (passo não é maior que o último aceito) é recusado sem consultar o banco', async () => {
    // Passo e código do mesmo instante (ver o teste acima).
    const totp = new TOTP({ secret: Secret.fromBase32(TOTP_SECRET) });
    const timestamp = Date.now();
    const repo = withRow({ totpEnabled: true, totpSecret: TOTP_SECRET, totpLastStep: totp.counter({ timestamp }) });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD, totp.generate({ timestamp }))).rejects.toThrow(INVALID);
    expect(repo.claimTotpStep).not.toHaveBeenCalled();
    expect(repo.registerLoginFailure).toHaveBeenCalled();
  });

  it('dois logins simultâneos com o mesmo código: o que perde a reserva é recusado', async () => {
    const repo = fakeRepo({
      findAuthByEmail: vi.fn().mockResolvedValue({ ...baseLookupRow(), totpEnabled: true, totpSecret: TOTP_SECRET }),
      claimTotpStep: vi.fn().mockResolvedValue(false),
    });
    await expect(new AuthService(repo).login(EMAIL, PASSWORD, validTotpCode())).rejects.toThrow(INVALID);
    expect(repo.startSession).not.toHaveBeenCalled();
  });

  it('senha certa num hash bcrypt antigo: entra e o hash scrypt novo vai junto com a sessão (M-04)', async () => {
    const repo = withRow({ passwordHash: bcrypt.hashSync(PASSWORD, 4) });
    await new AuthService(repo).login(EMAIL, PASSWORD);

    const extra = (repo.startSession as ReturnType<typeof vi.fn>).mock.calls[0]![3] as { passwordHash?: string };
    expect(extra.passwordHash).toMatch(/^scrypt\$/);
    expect((await verifyPassword(PASSWORD, extra.passwordHash!)).ok).toBe(true);
  });

  it('hash scrypt atual: não refaz o hash', async () => {
    const repo = fakeRepo();
    await new AuthService(repo).login(EMAIL, PASSWORD);
    const extra = (repo.startSession as ReturnType<typeof vi.fn>).mock.calls[0]![3] as { passwordHash?: string };
    expect(extra.passwordHash).toBeUndefined();
  });

  it('login abre a sessão do aparelho e grava só o SHA-256 do segredo, nunca o token cru', async () => {
    const startSession = vi.fn().mockResolvedValue(undefined);
    const service = new AuthService(fakeRepo({ startSession }));

    const result = await service.login(EMAIL, PASSWORD);

    expect(startSession).toHaveBeenCalledTimes(1);
    const [tenantId, userId, session] = startSession.mock.calls[0] as [string, string, { id: string; secretHash: string; expiresAt: Date }];
    expect([tenantId, userId]).toEqual([TENANT_ID, USER_ID]);
    const [sessionId, secret] = result.refreshToken.split('.') as [string, string];
    expect(session.id).toBe(sessionId);
    expect(session.secretHash).toBe(hashRefreshSecret(secret));
    expect(session.secretHash).not.toContain(secret);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('dois logins abrem duas sessões — um aparelho não derruba o outro', async () => {
    const startSession = vi.fn().mockResolvedValue(undefined);
    const service = new AuthService(fakeRepo({ startSession }));

    const a = await service.login(EMAIL, PASSWORD);
    const b = await service.login(EMAIL, PASSWORD);

    expect(a.refreshToken.split('.')[0]).not.toBe(b.refreshToken.split('.')[0]);
    expect(startSession).toHaveBeenCalledTimes(2);
  });
});

describe('AuthService.refresh', () => {
  it('rejeita token malformado sem tocar no banco', async () => {
    const repo = fakeRepo();
    const service = new AuthService(repo);

    await expect(service.refresh('token-sem-ponto')).rejects.toThrow(/Refresh token inválido/);
    await expect(service.refresh('nao-e-uuid.segredo')).rejects.toThrow(/Refresh token inválido/);
    expect(repo.findTenantIdForSession).not.toHaveBeenCalled();
  });

  it('rejeita sessão que não existe', async () => {
    const service = new AuthService(fakeRepo({ findTenantIdForSession: vi.fn().mockResolvedValue(null) }));
    await expect(service.refresh(REFRESH)).rejects.toThrow(/Sessão inválida/);
  });

  it('rotaciona: manda o hash do segredo apresentado e devolve um par novo da sessão seguinte', async () => {
    const rotateSession = vi.fn().mockResolvedValue({ outcome: 'rotated', user: SESSION_USER });
    const service = new AuthService(fakeRepo({ rotateSession }));

    const result = await service.refresh(REFRESH);

    const [tenantId, input] = rotateSession.mock.calls[0] as [
      string,
      { sessionId: string; secretHash: string; next: { id: string; secretHash: string }; graceMs: number },
    ];
    expect(tenantId).toBe(TENANT_ID);
    expect(input.sessionId).toBe(SESSION_ID);
    expect(input.secretHash).toBe(hashRefreshSecret('segredo-do-aparelho'));
    expect(input.graceMs).toBe(REFRESH_REUSE_GRACE_MS);
    const [nextId, nextSecret] = result.refreshToken.split('.') as [string, string];
    expect(nextId).toBe(input.next.id);
    expect(input.next.secretHash).toBe(hashRefreshSecret(nextSecret));
    expect(result.user).toMatchObject({ id: USER_ID, tenantId: TENANT_ID, plan: 'basic' });
    expect(result.accessToken.split('.')).toHaveLength(3);
  });

  it('dentro da tolerância (duas abas, nova tentativa) também devolve um par válido', async () => {
    const service = new AuthService(
      fakeRepo({ rotateSession: vi.fn().mockResolvedValue({ outcome: 'grace', user: SESSION_USER }) }),
    );
    await expect(service.refresh(REFRESH)).resolves.toMatchObject({ user: { id: USER_ID } });
  });

  it.each([
    ['reuse', /Sessão encerrada por segurança/],
    ['expired', /Sessão expirada/],
    ['revoked', /Sessão inválida/],
    ['invalid', /Sessão inválida/],
    ['inactive', /Sessão inválida/],
  ])('resultado %s vira 401 sem emitir token', async (outcome, message) => {
    const service = new AuthService(
      fakeRepo({ rotateSession: vi.fn().mockResolvedValue({ outcome, userId: USER_ID }) }),
    );
    await expect(service.refresh(REFRESH)).rejects.toMatchObject({ statusCode: 401, message: expect.stringMatching(message) });
  });
});

describe('AuthService.logout', () => {
  it('revoga a sessão deste aparelho com o hash do segredo apresentado', async () => {
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const service = new AuthService(fakeRepo({ revokeSession }));

    await service.logout(REFRESH);

    expect(revokeSession).toHaveBeenCalledWith(TENANT_ID, SESSION_ID, hashRefreshSecret('segredo-do-aparelho'));
  });

  it('é silencioso com token malformado ou de sessão inexistente', async () => {
    const revokeSession = vi.fn();
    const service = new AuthService(
      fakeRepo({ revokeSession, findTenantIdForSession: vi.fn().mockResolvedValue(null) }),
    );

    await expect(service.logout('lixo')).resolves.toBeUndefined();
    await expect(service.logout(REFRESH)).resolves.toBeUndefined();
    expect(revokeSession).not.toHaveBeenCalled();
  });
});
