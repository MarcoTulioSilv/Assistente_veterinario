/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do OwnerRepository
 *
 * POR QUE ESTE TESTE EXISTE:
 * owner.repository.ts nunca teve teste (só coberto indiretamente pelo
 * rls-isolation.test.ts, que exercita o isolamento entre tenants mas não
 * a lógica de negócio própria do repositório — paginação, RN-006 (cadastro
 * parcial fica pending), soft delete). Roda como quironequine_app (RLS ativo),
 * igual ao runtime real.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OwnerRepository } from '../src/repositories/owner.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@quironequine/shared-types';

const TENANT_ID = '99999999-9999-9999-9999-999999999999';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const repo = new OwnerRepository();

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: '88888888-8888-8888-8888-888888888888',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

describe('OwnerRepository', () => {
  beforeAll(async () => {
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Owner Repo Test', slug: 'owner-repo-test', plan: 'basic', status: 'active' },
    });
  });

  afterEach(async () => {
    await admin.owner.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('create() com cpf e phone preenchidos fica com status active', async () => {
    const created = await repo.create(ctx, { fullName: 'Completo', cpf: '111.222.333-44', phone: '(64) 90000-0000' });
    expect(created.status).toBe('active');
  });

  it('create() sem cpf ou phone fica com status pending (RN-006)', async () => {
    const created = await repo.create(ctx, { fullName: 'Parcial' });
    expect(created.status).toBe('pending');
  });

  it('findById() só encontra dentro do próprio tenant (RLS)', async () => {
    const created = await repo.create(ctx, { fullName: 'Isolado', cpf: '222.333.444-55', phone: '(64) 91111-1111' });

    const found = await repo.findById(ctx, created.id);
    expect(found?.id).toBe(created.id);

    const outroTenant: RequestContext = { ...ctx, tenantId: '00000000-0000-0000-0000-000000000000' };
    await expect(repo.findById(outroTenant, created.id)).resolves.toBeNull();
  });

  it('countActive() conta só registros não deletados', async () => {
    await repo.create(ctx, { fullName: 'Um', cpf: '333.444.555-66', phone: '(64) 92222-2222' });
    const dois = await repo.create(ctx, { fullName: 'Dois', cpf: '444.555.666-77', phone: '(64) 93333-3333' });

    expect(await repo.countActive(ctx)).toBe(2);

    await repo.softDelete(ctx, dois.id);
    expect(await repo.countActive(ctx)).toBe(1);
  });

  it('update() altera os campos informados', async () => {
    const created = await repo.create(ctx, { fullName: 'Original', cpf: '555.666.777-88', phone: '(64) 94444-4444' });
    const updated = await repo.update(ctx, created.id, { fullName: 'Alterado' });
    expect(updated.fullName).toBe('Alterado');
  });

  it('softDelete() marca deletedAt e some das buscas, sem apagar fisicamente (LGPD)', async () => {
    const created = await repo.create(ctx, { fullName: 'Pra Deletar', cpf: '666.777.888-99', phone: '(64) 95555-5555' });

    await repo.softDelete(ctx, created.id);

    await expect(repo.findById(ctx, created.id)).resolves.toBeNull();
    const stillInDb = await admin.owner.findUnique({ where: { id: created.id } });
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();
  });

  it('list() pagina, filtra por status e busca por nome', async () => {
    await repo.create(ctx, { fullName: 'Ana Silva', cpf: '777.888.999-00', phone: '(64) 96666-6666' });
    await repo.create(ctx, { fullName: 'Bruno Souza', cpf: '888.999.000-11', phone: '(64) 97777-7777' });
    await repo.create(ctx, { fullName: 'Ana Pereira' }); // pending, sem cpf/phone

    const ativos = await repo.list(ctx, { page: 1, limit: 20, status: 'active' });
    expect(ativos.data).toHaveLength(2);

    const busca = await repo.list(ctx, { page: 1, limit: 20, status: 'all', search: 'Ana' });
    expect(busca.data.map((o) => o.fullName).sort()).toEqual(['Ana Pereira', 'Ana Silva']);

    const paginaUm = await repo.list(ctx, { page: 1, limit: 2, status: 'all' });
    expect(paginaUm.data).toHaveLength(2);
    expect(paginaUm.pagination.total).toBe(3);
    expect(paginaUm.pagination.totalPages).toBe(2);
  });
});
