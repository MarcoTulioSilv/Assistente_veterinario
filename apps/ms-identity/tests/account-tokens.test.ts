/**
 * ══════════════════════════════════════════════════════════════════
 * Confirmação de e-mail, recuperação de senha e diretório de destinatários
 * (auditoria M-02, ADR-007) — Sprint 10 do M3
 *
 * O que só o Postgres real prova: a função SECURITY DEFINER acha o token
 * antes do login; o consumo é de uso único (UPDATE condicional); trocar a
 * senha encerra as sessões de todos os aparelhos; o diretório não enxerga
 * outro tenant. Roda como quironequine_app.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { DomainEvent, AccountEmailPayload } from '@quironequine/shared-types';
import { AccountRepository } from '../src/repositories/account.repository';
import { AuthRepository } from '../src/repositories/auth.repository';
import { RecipientRepository } from '../src/repositories/recipient.repository';
import { AccountService } from '../src/services/account.service';
import { RecipientService } from '../src/services/recipient.service';
import { AuthService } from '../src/services/auth.service';
import { verifyPassword, hashPassword } from '../src/lib/password';
import { prisma as appPrisma } from '../src/prisma';

const TENANT_ID = 'b10c0000-0000-4000-8000-000000000010';
const OTHER_TENANT = 'b10c0000-0000-4000-8000-000000000011';
const USER_ID = 'b10c0000-0000-4000-8000-0000000000ba';
const ADMIN_2 = 'b10c0000-0000-4000-8000-0000000000bb';
const INACTIVE = 'b10c0000-0000-4000-8000-0000000000bc';
const VET_ID = 'b10c0000-0000-4000-8000-0000000000cc';
const EMAIL = 'conta@teste.quironequine.com.br';
const PASSWORD = 'senha-antiga-do-teste';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const accountRepo = new AccountRepository();
const authRepo = new AuthRepository();

/** Guarda o que seria publicado — o token cru só existe aqui (no evento). */
const published: Array<DomainEvent<AccountEmailPayload>> = [];
let now = new Date();
const account = new AccountService(accountRepo, authRepo, async (e) => void published.push(e), () => now, () => true);
const directory = new RecipientService(new RecipientRepository());

async function cleanup(): Promise<void> {
  await admin.auditLog.deleteMany({ where: { tenantId: { in: [TENANT_ID, OTHER_TENANT] } } });
  await admin.tenant.deleteMany({ where: { id: { in: [TENANT_ID, OTHER_TENANT] } } }); // cascata
}

function lastToken(): string {
  return published[published.length - 1]!.payload.token;
}

describe('conta: tokens de uso único e diretório (M-02, ADR-007)', () => {
  beforeAll(async () => {
    process.env['JWT_SECRET'] ??= 'test-secret-com-mais-de-32-caracteres-aqui';
    await cleanup();
    for (const [id, slug] of [[TENANT_ID, 'conta-tokens-test'], [OTHER_TENANT, 'conta-tokens-outro']] as const) {
      await admin.tenant.create({ data: { id, name: slug, slug, plan: 'basic', status: 'active' } });
    }
  });

  beforeEach(async () => {
    published.length = 0;
    now = new Date();
    await admin.userToken.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.userSession.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.veterinarian.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.user.deleteMany({ where: { tenantId: { in: [TENANT_ID, OTHER_TENANT] } } });
    const passwordHash = await hashPassword(PASSWORD);
    await admin.user.createMany({
      data: [
        { id: USER_ID, tenantId: TENANT_ID, email: EMAIL, passwordHash, fullName: 'Conta', role: 'admin' },
        { id: ADMIN_2, tenantId: TENANT_ID, email: 'admin2@teste.quironequine.com.br', passwordHash, fullName: 'Admin 2', role: 'admin', emailVerifiedAt: new Date() },
        { id: INACTIVE, tenantId: TENANT_ID, email: 'inativo@teste.quironequine.com.br', passwordHash, fullName: 'Inativo', role: 'admin', status: 'inactive' },
      ],
    });
    await admin.veterinarian.create({
      data: { id: VET_ID, tenantId: TENANT_ID, userId: USER_ID, fullName: 'Conta', crmv: 'GO-1', crmvState: 'GO', cpfCnpj: '900.000.000-91', phone: '1', email: EMAIL },
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('confirmação: o token acha o tenant sem login, confirma uma vez e não vale de novo', async () => {
    await account.sendVerificationAfterSignup(TENANT_ID, USER_ID, EMAIL);
    const token = lastToken();

    await account.confirmEmail(token);

    const user = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
    expect(user.emailVerifiedAt).not.toBeNull();
    await expect(account.confirmEmail(token)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Só o hash fica no banco.
    expect(await admin.userToken.count({ where: { tokenHash: token } })).toBe(0);
  });

  it('link novo invalida o anterior', async () => {
    await account.sendVerificationAfterSignup(TENANT_ID, USER_ID, EMAIL);
    const old = lastToken();
    now = new Date(now.getTime() + 61_000);
    await account.requestEmailVerification(EMAIL);

    await expect(account.confirmEmail(old)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await account.confirmEmail(lastToken());
  });

  it('recuperação: troca a senha, encerra as sessões de todos os aparelhos e o token vencido não vale', async () => {
    await admin.userSession.createMany({
      data: [1, 2].map((n) => ({
        id: `b10c0000-0000-4000-8000-00000000050${n}`,
        tenantId: TENANT_ID,
        userId: USER_ID,
        familyId: `b10c0000-0000-4000-8000-00000000050${n}`,
        secretHash: 'x'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    });

    await account.requestPasswordReset(EMAIL);
    await account.resetPassword(lastToken(), 'senha-nova-do-teste');

    const user = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
    expect((await verifyPassword('senha-nova-do-teste', user.passwordHash)).ok).toBe(true);
    const sessions = await admin.userSession.findMany({ where: { userId: USER_ID } });
    expect(sessions.every((s) => s.revokedReason === 'password_reset')).toBe(true);

    // Token emitido e deixado vencer.
    now = new Date(now.getTime() + 61_000);
    await account.requestPasswordReset(EMAIL);
    now = new Date(now.getTime() + 31 * 60_000);
    await expect(account.resetPassword(lastToken(), 'outra-senha-123')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('login com a confirmação ligada: só depois de confirmar', async () => {
    await admin.user.update({ where: { id: USER_ID }, data: { emailVerifiedAt: null } });
    const auth = new AuthService(authRepo, () => true);

    await expect(auth.login(EMAIL, PASSWORD)).rejects.toMatchObject({ statusCode: 403 });
    await admin.user.update({ where: { id: USER_ID }, data: { emailVerifiedAt: new Date() } });
    await expect(auth.login(EMAIL, PASSWORD)).resolves.toMatchObject({ user: { id: USER_ID } });
  });

  it('diretório: veterinário → usuário, admins ativos, nada de outro tenant nem de conta inativa', async () => {
    expect(await directory.byVeterinarian(TENANT_ID, VET_ID)).toMatchObject({ userId: USER_ID, email: EMAIL });
    expect((await directory.tenantAdmins(TENANT_ID)).map((r) => r.userId).sort()).toEqual([USER_ID, ADMIN_2].sort());
    expect(await directory.byUser(TENANT_ID, INACTIVE)).toBeNull();
    expect(await directory.byUser(OTHER_TENANT, USER_ID)).toBeNull();
    expect(await directory.byVeterinarian(OTHER_TENANT, VET_ID)).toBeNull();
    expect(await directory.tenantAdmins(OTHER_TENANT)).toEqual([]);
  });
});
