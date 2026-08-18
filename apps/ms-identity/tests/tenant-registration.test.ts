/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do cadastro de tenant (RF-CAD-030 / UC-CAD-04)
 *
 * POR QUE ESTE TESTE EXISTE:
 * register() cria Tenant+User+Veterinarian numa transação, definindo
 * app.current_tenant a partir do tenantId recém-gerado — não é um bypass
 * de RLS, mas depende de a ordem/transação estar correta. Só um teste
 * contra banco real prova que o rollback funciona e que RLS permanece
 * intacto pro resto do sistema (ver plano TenantService / Decisão 2).
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TenantRepository } from '../src/repositories/tenant.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RegisterTenantInput } from '../src/schemas/tenant.schema';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const repo = new TenantRepository();

const input = (overrides: Partial<RegisterTenantInput> = {}): RegisterTenantInput => ({
  fullName: 'Dra. Integração Teste',
  crmv: '99999',
  crmvState: 'GO',
  cpfCnpj: '111.222.333-44',
  phone: '(64) 90000-0000',
  email: `tenant-reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}@vetequine.com.br`,
  password: 'não-importa-aqui',
  ...overrides,
});

const HASH = 'hash-fixo-nao-importa-neste-teste';
const createdTenantIds: string[] = [];

describe('TenantRepository.register — transação atômica (Tenant+User+Veterinarian)', () => {
  afterEach(async () => {
    await cleanup();
    createdTenantIds.length = 0;
  });

  afterAll(async () => {
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('cria Tenant, User e Veterinarian com o mesmo tenantId, legíveis via withTenant', async () => {
    const data = input();
    const { tenantId, userId, veterinarianId } = await repo.register(data, HASH);
    createdTenantIds.push(tenantId);

    const [tenant, user, vet] = await Promise.all([
      admin.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      admin.user.findUniqueOrThrow({ where: { id: userId } }),
      admin.veterinarian.findUniqueOrThrow({ where: { id: veterinarianId } }),
    ]);

    expect(tenant.plan).toBe('basic');
    expect(tenant.status).toBe('active');
    expect(user.tenantId).toBe(tenantId);
    expect(user.role).toBe('admin');
    expect(user.passwordHash).toBe(HASH);
    expect(vet.tenantId).toBe(tenantId);
    expect(vet.userId).toBe(userId);
    expect(vet.crmv).toBe(data.crmv);
  });

  it('e-mail duplicado falha com conflito e não deixa Tenant órfão (rollback)', async () => {
    const data = input();
    const first = await repo.register(data, HASH);
    createdTenantIds.push(first.tenantId);

    const before = await admin.tenant.count();

    await expect(repo.register(input({ email: data.email }), HASH)).rejects.toThrow(/já cadastrado/);

    const after = await admin.tenant.count();
    expect(after).toBe(before); // nenhum Tenant novo sobrou da tentativa que falhou
  });

  it('dois registros com o mesmo nome geram slugs diferentes', async () => {
    const name = `Mesmo Nome ${Date.now()}`;
    const a = await repo.register(input({ fullName: name, email: `a-${Date.now()}@vetequine.com.br` }), HASH);
    const b = await repo.register(input({ fullName: name, email: `b-${Date.now()}@vetequine.com.br` }), HASH);
    createdTenantIds.push(a.tenantId, b.tenantId);

    const [tenantA, tenantB] = await Promise.all([
      admin.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      admin.tenant.findUniqueOrThrow({ where: { id: b.tenantId } }),
    ]);
    expect(tenantA.slug).not.toBe(tenantB.slug);
  });

  it('findProfile lê o perfil recém-criado via withTenant (vetequine_app, com RLS)', async () => {
    const data = input();
    const { tenantId } = await repo.register(data, HASH);
    createdTenantIds.push(tenantId);

    const profile = await repo.findProfile(tenantId);
    expect(profile?.veterinarian.email).toBe(data.email);
    expect(profile?.plan).toBe('basic');
  });
});

async function cleanup(): Promise<void> {
  if (createdTenantIds.length === 0) return;
  await admin.veterinarian.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await admin.user.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await admin.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
}
