/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do AuthRepository (funções SECURITY DEFINER +
 * caminho normal via withTenant)
 *
 * POR QUE ESTE TESTE EXISTE:
 * findAuthByEmail/findTenantIdForUser são a única exceção documentada
 * a "toda leitura de users passa por withTenant()" (ADR-004). O
 * objetivo é provar que o AuthRepository funciona de ponta a ponta
 * rodando como a role RESTRITA (vetequine_app, mesma conexão usada
 * em produção via src/prisma.ts), sem abrir uma porta mais larga do
 * que a estritamente necessária.
 *
 * Refs: ADR-004 / ADR-001 §5.2
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuthRepository } from '../src/repositories/auth.repository';
import { prisma as appPrisma } from '../src/prisma';

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const DELETED_USER_ID = '55555555-5555-5555-5555-555555555555';
const EMAIL = 'auth-lookup-test@vetequine.com.br';
const DELETED_EMAIL = 'auth-lookup-deleted@vetequine.com.br';
const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000';

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
      await expect(repo.findAuthByEmail('nao-existe@vetequine.com.br')).resolves.toBeNull();
    });

    it('ignora usuário soft-deletado', async () => {
      await expect(repo.findAuthByEmail(DELETED_EMAIL)).resolves.toBeNull();
    });
  });

  describe('findTenantIdForUser', () => {
    it('acha o tenant do usuário', async () => {
      await expect(repo.findTenantIdForUser(USER_ID)).resolves.toBe(TENANT_ID);
    });

    it('retorna null para usuário deletado ou inexistente', async () => {
      await expect(repo.findTenantIdForUser(DELETED_USER_ID)).resolves.toBeNull();
      await expect(repo.findTenantIdForUser(UNKNOWN_USER_ID)).resolves.toBeNull();
    });
  });

  describe('caminho normal via withTenant (findById / grava e limpa refresh token)', () => {
    it('findById traz o usuário com o plano atual do tenant', async () => {
      const row = await repo.findById(TENANT_ID, USER_ID);
      expect(row?.email).toBe(EMAIL);
      expect(row?.tenantPlan).toBe('basic');
      expect(row?.refreshTokenHash).toBeNull();
    });

    it('recordSuccessfulLogin grava hash e expiração; rotateRefreshToken troca o hash; clearRefreshToken zera', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      await repo.recordSuccessfulLogin(TENANT_ID, USER_ID, 'hash-1', expiresAt);

      let row = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
      expect(row.refreshTokenHash).toBe('hash-1');
      expect(row.lastLoginAt).not.toBeNull();

      await repo.rotateRefreshToken(TENANT_ID, USER_ID, 'hash-2', expiresAt);
      row = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
      expect(row.refreshTokenHash).toBe('hash-2');

      await repo.clearRefreshToken(TENANT_ID, USER_ID);
      row = await admin.user.findUniqueOrThrow({ where: { id: USER_ID } });
      expect(row.refreshTokenHash).toBeNull();
      expect(row.refreshTokenExpiresAt).toBeNull();
    });
  });
});

async function cleanup(): Promise<void> {
  await admin.user.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
}
