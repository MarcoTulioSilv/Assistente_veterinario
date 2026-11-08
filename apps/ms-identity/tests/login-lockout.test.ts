/**
 * ══════════════════════════════════════════════════════════════════
 * Bloqueio de login, TOTP sem reuso e re-hash da senha (auditoria M-02/M-04)
 *
 * POR QUE ESTE TESTE EXISTE: a progressão do bloqueio é calculada no SQL
 * (um UPDATE só, para tentativas simultâneas não perderem contagem) e a
 * reserva do passo de TOTP é um UPDATE condicional. Só contra o Postgres
 * real dá para saber que os dois funcionam. Roda como quironequine_app.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuthRepository, LOCK_THRESHOLD, MAX_LOCK_MINUTES } from '../src/repositories/auth.repository';
import { AuthService } from '../src/services/auth.service';
import { verifyPassword } from '../src/lib/password';
import { prisma as appPrisma } from '../src/prisma';

const TENANT_ID = 'b10c0000-0000-4000-8000-000000000001';
const USER_ID = 'b10c0000-0000-4000-8000-0000000000aa';
const EMAIL = 'bloqueio@teste.quironequine.com.br';
const PASSWORD = 'senha-certa-do-teste';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const repo = new AuthRepository();
const service = new AuthService(repo);

async function cleanup(): Promise<void> {
  await admin.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.tenant.deleteMany({ where: { id: TENANT_ID } }); // cascata: users, sessions
}

describe('login: bloqueio progressivo, TOTP e re-hash (M-02/M-04)', () => {
  beforeAll(async () => {
    process.env['JWT_SECRET'] ??= 'test-secret-com-mais-de-32-caracteres-aqui';
    await cleanup();
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Bloqueio', slug: 'login-lockout-test', plan: 'basic', status: 'active' },
    });
  });

  beforeEach(async () => {
    await admin.user.deleteMany({ where: { tenantId: TENANT_ID } });
    // Hash legado (bcrypt, custo baixo para o teste): o login certo tem que trocá-lo.
    await admin.user.create({
      data: {
        id: USER_ID,
        tenantId: TENANT_ID,
        email: EMAIL,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        fullName: 'Usuário Bloqueio',
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('a função de lookup devolve o contador, o bloqueio e o último passo de TOTP', async () => {
    const row = await repo.findAuthByEmail(EMAIL);
    expect(row).toMatchObject({ failedLoginCount: 0, lockedUntil: null, totpLastStep: null });
  });

  it('bloqueia a partir da 5ª falha seguida: 1, 2, 4, 8 minutos, com teto de 15', async () => {
    const minutes: Array<number | null> = [];
    for (let i = 1; i <= LOCK_THRESHOLD + 6; i++) {
      const before = Date.now();
      const { failedLoginCount, lockedUntil } = await repo.registerLoginFailure(TENANT_ID, USER_ID);
      expect(failedLoginCount).toBe(i);
      minutes.push(lockedUntil ? Math.round((lockedUntil.getTime() - before) / 60_000) : null);
    }
    expect(minutes).toEqual([null, null, null, null, 1, 2, 4, 8, MAX_LOCK_MINUTES, MAX_LOCK_MINUTES, MAX_LOCK_MINUTES]);
  });

  it('o teto vale mesmo com muitas falhas acumuladas (sem estourar o inteiro)', async () => {
    await admin.user.update({ where: { id: USER_ID }, data: { failedLoginCount: 500 } });
    const { lockedUntil } = await repo.registerLoginFailure(TENANT_ID, USER_ID);
    expect(Math.round((lockedUntil!.getTime() - Date.now()) / 60_000)).toBe(MAX_LOCK_MINUTES);
  });

  it('falhas simultâneas não perdem contagem', async () => {
    await Promise.all(Array.from({ length: 8 }, () => repo.registerLoginFailure(TENANT_ID, USER_ID)));
    const user = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
    expect(user.failedLoginCount).toBe(8);
  });

  it('conta bloqueada recusa a senha certa; depois do bloqueio, entra, zera o contador e troca o bcrypt por scrypt', async () => {
    await admin.user.update({
      where: { id: USER_ID },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) },
    });
    await expect(service.login(EMAIL, PASSWORD)).rejects.toThrow(/Credenciais inválidas/);

    await admin.user.update({ where: { id: USER_ID }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await service.login(EMAIL, PASSWORD);

    const user = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect((await verifyPassword(PASSWORD, user.passwordHash)).ok).toBe(true);
  });

  it('o mesmo passo de TOTP só é reservado uma vez, mesmo em paralelo', async () => {
    const results = await Promise.all([
      repo.claimTotpStep(TENANT_ID, USER_ID, 1000),
      repo.claimTotpStep(TENANT_ID, USER_ID, 1000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(repo.claimTotpStep(TENANT_ID, USER_ID, 999)).resolves.toBe(false); // mais antigo
    await expect(repo.claimTotpStep(TENANT_ID, USER_ID, 1001)).resolves.toBe(true); // próximo
  });
});
