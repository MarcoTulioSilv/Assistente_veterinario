/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do AuthRepository (funções SECURITY DEFINER +
 * caminho normal via withTenant)
 *
 * POR QUE ESTE TESTE EXISTE:
 * findAuthByEmail/findTenantIdForUser são a única exceção documentada
 * a "toda leitura de users passa por withTenant()" (ADR-004). O
 * objetivo é provar que o AuthRepository funciona de ponta a ponta
 * rodando como a role RESTRITA (quironequine_app, mesma conexão usada
 * em produção via src/prisma.ts), sem abrir uma porta mais larga do
 * que a estritamente necessária.
 *
 * Refs: ADR-004 / ADR-001 §5.2
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../src/repositories/auth.repository';
import { prisma as appPrisma } from '../src/prisma';

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const DELETED_USER_ID = '55555555-5555-5555-5555-555555555555';
const EMAIL = 'auth-lookup-test@quironequine.com.br';
const DELETED_EMAIL = 'auth-lookup-deleted@quironequine.com.br';
const UNKNOWN_SESSION_ID = '00000000-0000-0000-0000-000000000000';
const GRACE_MS = 30_000;
const IN_A_WEEK = () => new Date(Date.now() + 7 * 86_400_000);

/** Abre uma sessão como o login faria e devolve o id. */
async function login(secretHash = 'hash-login'): Promise<string> {
  const id = randomUUID();
  await repo.startSession(TENANT_ID, USER_ID, { id, secretHash, expiresAt: IN_A_WEEK() });
  return id;
}

function next(secretHash: string): { id: string; secretHash: string; expiresAt: Date } {
  return { id: randomUUID(), secretHash, expiresAt: IN_A_WEEK() };
}

/** Conexao de migration: superusuario, ignora RLS. Usada so no setup/assert. */
const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });

const repo = new AuthRepository();

describe('AuthRepository — bypass controlado de RLS (ADR-004)', () => {
  beforeAll(async () => {
    await cleanup();

    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Auth Lookup', slug: 'auth-lookup-test', plan: 'basic', status: 'active' },
    });

    await admin.user.create({
      data: {
        id: USER_ID,
        tenantId: TENANT_ID,
        email: EMAIL,
        passwordHash: 'hash-nao-importa-neste-teste',
        fullName: 'Usuario Auth Lookup',
        role: 'admin',
        status: 'active',
      },
    });

    await admin.user.create({
      data: {
        id: DELETED_USER_ID,
        tenantId: TENANT_ID,
        email: DELETED_EMAIL,
        passwordHash: 'hash-nao-importa-neste-teste',
        fullName: 'Usuario Deletado',
        role: 'admin',
        status: 'active',
        deletedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('conexão de runtime não consegue SELECT direto em users sem tenant definido', async () => {
    const rows = await appPrisma.$queryRaw<Array<{ email: string }>>`
      SELECT email FROM users WHERE id = ${USER_ID}::uuid
    `;
    expect(rows).toHaveLength(0);
  });

  describe('findAuthByEmail', () => {
    it('acha o usuário pelo e-mail, mapeado para AuthLookupRow', async () => {
      const row = await repo.findAuthByEmail(EMAIL);
      expect(row).not.toBeNull();
      expect(row?.id).toBe(USER_ID);
      expect(row?.tenantId).toBe(TENANT_ID);
      expect(row?.tenantStatus).toBe('active');
      expect(row?.tenantPlan).toBe('basic');
      expect(row?.userStatus).toBe('active');
    });

    it('retorna null para e-mail inexistente', async () => {
      await expect(repo.findAuthByEmail('nao-existe@quironequine.com.br')).resolves.toBeNull();
    });

    it('ignora usuário soft-deletado', async () => {
      await expect(repo.findAuthByEmail(DELETED_EMAIL)).resolves.toBeNull();
    });
  });

  it('conexão de runtime não enxerga user_sessions sem tenant definido', async () => {
    await login();
    const rows = await appPrisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM user_sessions`;
    expect(rows).toHaveLength(0);
  });

  describe('findTenantIdForSession (SECURITY DEFINER)', () => {
    it('acha o tenant da sessão e nada para sessão inexistente', async () => {
      const id = await login();
      await expect(repo.findTenantIdForSession(id)).resolves.toBe(TENANT_ID);
      await expect(repo.findTenantIdForSession(UNKNOWN_SESSION_ID)).resolves.toBeNull();
    });
  });

  describe('sessões por aparelho (auditoria A-03)', () => {
    it('login grava a sessão (família = ela mesma) e o último acesso', async () => {
      const id = await login('hash-a');
      const row = await admin.userSession.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ familyId: id, secretHash: 'hash-a', revokedAt: null, tenantId: TENANT_ID });
      const user = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
      expect(user.lastLoginAt).not.toBeNull();
    });

    it('dois aparelhos convivem: renovar um não mexe no outro', async () => {
      const celular = await login('hash-celular');
      const notebook = await login('hash-notebook');

      const r = await repo.rotateSession(TENANT_ID, { sessionId: celular, secretHash: 'hash-celular', next: next('h2'), graceMs: GRACE_MS });

      expect(r.outcome).toBe('rotated');
      const outro = await admin.userSession.findUniqueOrThrow({ where: { id: notebook } });
      expect(outro.revokedAt).toBeNull();
    });

    it('rotação: a linha vigente vira `rotated` e a próxima nasce na mesma família', async () => {
      const id = await login('hash-1');
      const seguinte = next('hash-2');

      const r = await repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: seguinte, graceMs: GRACE_MS });

      expect(r).toMatchObject({ outcome: 'rotated', user: { id: USER_ID, email: EMAIL, tenantPlan: 'basic' } });
      const antiga = await admin.userSession.findUniqueOrThrow({ where: { id } });
      expect(antiga.revokedReason).toBe('rotated');
      const nova = await admin.userSession.findUniqueOrThrow({ where: { id: seguinte.id } });
      expect(nova).toMatchObject({ familyId: id, secretHash: 'hash-2', revokedAt: null });
    });

    it('renovações simultâneas com o mesmo token: uma rotaciona, a outra cai na tolerância — ninguém é derrubado', async () => {
      const id = await login('hash-1');

      const resultados = await Promise.all([
        repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: next('aba-1'), graceMs: GRACE_MS }),
        repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: next('aba-2'), graceMs: GRACE_MS }),
      ]);

      expect(resultados.map((r) => r.outcome).sort()).toEqual(['grace', 'rotated']);
      const vivas = await admin.userSession.count({ where: { familyId: id, revokedAt: null } });
      expect(vivas).toBe(2);
    });

    it('token já rotacionado fora da tolerância: revoga a família inteira (token roubado)', async () => {
      const id = await login('hash-1');
      const seguinte = next('hash-2');
      await repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: seguinte, graceMs: GRACE_MS });
      await admin.userSession.update({ where: { id }, data: { rotatedAt: new Date(Date.now() - GRACE_MS - 1000) } });

      const r = await repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: next('hash-3'), graceMs: GRACE_MS });

      expect(r).toEqual({ outcome: 'reuse', userId: USER_ID });
      const legitima = await admin.userSession.findUniqueOrThrow({ where: { id: seguinte.id } });
      expect(legitima.revokedReason).toBe('reuse');
    });

    it('segredo errado, sessão expirada e sessão após logout não renovam', async () => {
      const id = await login('hash-1');
      await expect(
        repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'outro', next: next('x'), graceMs: GRACE_MS }),
      ).resolves.toEqual({ outcome: 'invalid' });

      const vencida = await login('hash-v');
      await admin.userSession.update({ where: { id: vencida }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(
        repo.rotateSession(TENANT_ID, { sessionId: vencida, secretHash: 'hash-v', next: next('x'), graceMs: GRACE_MS }),
      ).resolves.toEqual({ outcome: 'expired' });

      await repo.revokeSession(TENANT_ID, id, 'hash-1');
      await expect(
        repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: next('x'), graceMs: GRACE_MS }),
      ).resolves.toEqual({ outcome: 'revoked' });
    });

    it('logout só revoga com o segredo certo, e só a sessão deste aparelho', async () => {
      const id = await login('hash-1');
      const outro = await login('hash-outro');

      await repo.revokeSession(TENANT_ID, id, 'segredo-errado');
      expect((await admin.userSession.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();

      await repo.revokeSession(TENANT_ID, id, 'hash-1');
      expect((await admin.userSession.findUniqueOrThrow({ where: { id } })).revokedReason).toBe('logout');
      expect((await admin.userSession.findUniqueOrThrow({ where: { id: outro } })).revokedAt).toBeNull();
    });

    it('usuário desativado não renova', async () => {
      const id = await login('hash-1');
      await admin.user.update({ where: { id: USER_ID }, data: { status: 'inactive' } });
      try {
        await expect(
          repo.rotateSession(TENANT_ID, { sessionId: id, secretHash: 'hash-1', next: next('x'), graceMs: GRACE_MS }),
        ).resolves.toEqual({ outcome: 'inactive' });
      } finally {
        await admin.user.update({ where: { id: USER_ID }, data: { status: 'active' } });
      }
    });
  });
});

async function cleanup(): Promise<void> {
  await admin.userSession.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.user.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
}
