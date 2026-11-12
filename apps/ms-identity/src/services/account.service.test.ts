import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent, AccountEmailPayload } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { AccountRepository, TokenLookup } from '../repositories/account.repository';
import { verifyPassword } from '../lib/password';
import {
  AccountService,
  hashAccountToken,
  VERIFY_EMAIL_TTL_MS,
  RESET_PASSWORD_TTL_MS,
  RESEND_INTERVAL_MS,
} from './account.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const EMAIL = 'vet@clinica.com.br';
const NOW = new Date('2026-11-13T12:00:00Z');

function token(overrides: Partial<TokenLookup> = {}): TokenLookup {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    tenantId: TENANT,
    userId: USER,
    purpose: 'verify_email',
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    ...overrides,
  };
}

function setup(opts: { enabled?: boolean; repo?: Partial<Record<keyof AccountRepository, unknown>>; lookup?: unknown } = {}) {
  const repo = {
    findUser: vi.fn().mockResolvedValue({ id: USER, email: EMAIL, emailVerifiedAt: null, active: true }),
    lastTokenCreatedAt: vi.fn().mockResolvedValue(null),
    createToken: vi.fn().mockResolvedValue(undefined),
    findToken: vi.fn().mockResolvedValue(token()),
    consumeVerifyToken: vi.fn().mockResolvedValue(true),
    consumeResetToken: vi.fn().mockResolvedValue(true),
    ...opts.repo,
  } as unknown as AccountRepository;
  const lookup = {
    findAuthByEmail: vi
      .fn()
      .mockResolvedValue(
        opts.lookup === undefined ? { id: USER, tenantId: TENANT, userStatus: 'active', tenantStatus: 'active' } : opts.lookup,
      ),
  };
  const publish = vi.fn<(e: DomainEvent<AccountEmailPayload>) => Promise<void>>().mockResolvedValue(undefined);
  const service = new AccountService(repo, lookup, publish, () => NOW, () => opts.enabled ?? true);
  return { repo, lookup, publish, service };
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

describe('confirmação de e-mail (M-02)', () => {
  it('cadastro com envio ligado: grava só o hash e publica o token cru, válido por 24 h', async () => {
    const { service, repo, publish } = setup();

    await service.sendVerificationAfterSignup(TENANT, USER, EMAIL);

    const event = publish.mock.calls[0]![0];
    expect(event.name).toBe('auth.email_verification_requested');
    expect(event.tenantId).toBe(TENANT);
    expect(event.payload.email).toBe(EMAIL);
    expect(event.payload.expiresAt).toBe(new Date(NOW.getTime() + VERIFY_EMAIL_TTL_MS).toISOString());
    expect(repo.createToken).toHaveBeenCalledWith(
      TENANT,
      USER,
      'verify_email',
      hashAccountToken(event.payload.token),
      new Date(NOW.getTime() + VERIFY_EMAIL_TTL_MS),
      NOW,
    );
  });

  it('cadastro com envio desligado: nada é gerado', async () => {
    const { service, repo, publish } = setup({ enabled: false });
    await service.sendVerificationAfterSignup(TENANT, USER, EMAIL);
    expect(repo.createToken).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('falha ao publicar no cadastro não desfaz o cadastro', async () => {
    const { service, publish } = setup();
    publish.mockRejectedValueOnce(new Error('redis fora'));
    await expect(service.sendVerificationAfterSignup(TENANT, USER, EMAIL)).resolves.toBeUndefined();
  });

  it('reenvio público nunca revela nada: desligado, sem conta, já confirmado, pedido recente ou falha terminam igual', async () => {
    const quiet = [
      setup({ enabled: false }),
      setup({ lookup: null }),
      setup({ repo: { findUser: vi.fn().mockResolvedValue({ id: USER, email: EMAIL, emailVerifiedAt: NOW, active: true }) } }),
      setup({ repo: { lastTokenCreatedAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - RESEND_INTERVAL_MS + 1)) } }),
      setup({ repo: { findUser: vi.fn().mockResolvedValue(null) } }),
    ];
    for (const { service, publish } of quiet) {
      await expect(service.requestEmailVerification(EMAIL)).resolves.toBeUndefined();
      expect(publish).not.toHaveBeenCalled();
    }
    const failing = setup();
    failing.publish.mockRejectedValueOnce(new Error('redis fora'));
    await expect(failing.service.requestEmailVerification(EMAIL)).resolves.toBeUndefined();
  });

  it('reenvio passado o intervalo publica um link novo para o e-mail cadastrado', async () => {
    const { service, publish } = setup({
      repo: { lastTokenCreatedAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - RESEND_INTERVAL_MS)) },
    });
    await service.requestEmailVerification(EMAIL);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].payload.email).toBe(EMAIL);
  });

  it('confirma com o token certo, procurando pelo hash', async () => {
    const { service, repo } = setup();
    await service.confirmEmail('token-cru');
    expect(repo.findToken).toHaveBeenCalledWith(hashAccountToken('token-cru'));
    expect(repo.consumeVerifyToken).toHaveBeenCalledWith(token(), NOW);
  });

  it('token inexistente, usado, vencido, de outro tipo ou consumido no meio-tempo → 422', async () => {
    const cases = [
      setup({ repo: { findToken: vi.fn().mockResolvedValue(null) } }),
      setup({ repo: { findToken: vi.fn().mockResolvedValue(token({ usedAt: NOW })) } }),
      setup({ repo: { findToken: vi.fn().mockResolvedValue(token({ expiresAt: NOW })) } }),
      setup({ repo: { findToken: vi.fn().mockResolvedValue(token({ purpose: 'reset_password' })) } }),
      setup({ repo: { consumeVerifyToken: vi.fn().mockResolvedValue(false) } }),
    ];
    for (const { service } of cases) await rejectsWith(service.confirmEmail('x'), 'VALIDATION_ERROR');
    await rejectsWith(setup().service.confirmEmail(''), 'VALIDATION_ERROR');
  });
});

describe('recuperação de senha (M-02)', () => {
  it('conta ativa: publica o pedido com token de 30 min', async () => {
    const { service, publish } = setup();
    await service.requestPasswordReset(EMAIL);
    const event = publish.mock.calls[0]![0];
    expect(event.name).toBe('auth.password_reset_requested');
    expect(event.payload.expiresAt).toBe(new Date(NOW.getTime() + RESET_PASSWORD_TTL_MS).toISOString());
  });

  it('nunca revela nada: sem conta, conta inativa, envio desligado, pedido recente ou falha de publicação terminam igual', async () => {
    const quiet = [
      setup({ lookup: null }),
      setup({ lookup: { id: USER, tenantId: TENANT, userStatus: 'inactive', tenantStatus: 'active' } }),
      setup({ enabled: false }),
      setup({ repo: { lastTokenCreatedAt: vi.fn().mockResolvedValue(NOW) } }),
    ];
    for (const { service, publish } of quiet) {
      await expect(service.requestPasswordReset(EMAIL)).resolves.toBeUndefined();
      expect(publish).not.toHaveBeenCalled();
    }
    const failing = setup();
    failing.publish.mockRejectedValueOnce(new Error('redis fora'));
    await expect(failing.service.requestPasswordReset(EMAIL)).resolves.toBeUndefined();
  });

  it('troca a senha com hash scrypt novo', async () => {
    const { service, repo } = setup({ repo: { findToken: vi.fn().mockResolvedValue(token({ purpose: 'reset_password' })) } });

    await service.resetPassword('token-cru', 'senha-nova-123');

    const [found, hash, at] = (repo.consumeResetToken as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(found).toMatchObject({ purpose: 'reset_password' });
    expect(at).toBe(NOW);
    expect((await verifyPassword('senha-nova-123', hash as string)).ok).toBe(true);
  });

  it('senha curta, token de confirmação ou token já consumido → 422', async () => {
    await rejectsWith(setup().service.resetPassword('x', 'curta'), 'VALIDATION_ERROR');
    await rejectsWith(setup().service.resetPassword('x', 'senha-nova-123'), 'VALIDATION_ERROR'); // token é verify_email
    await rejectsWith(
      setup({
        repo: {
          findToken: vi.fn().mockResolvedValue(token({ purpose: 'reset_password' })),
          consumeResetToken: vi.fn().mockResolvedValue(false),
        },
      }).service.resetPassword('x', 'senha-nova-123'),
      'VALIDATION_ERROR',
    );
  });
});
