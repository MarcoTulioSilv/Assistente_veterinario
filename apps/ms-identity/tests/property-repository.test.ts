/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do PropertyRepository
 *
 * POR QUE ESTE TESTE EXISTE: cobre RN-006 (cadastro parcial fica
 * pending), a criação de property_owners a partir de ownerIds (lógica
 * nova, sem precedente no Owner), o filtro por ownerId em list(), e
 * roda como vetequine_app (RLS ativo), igual ao runtime real.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PropertyRepository } from '../src/repositories/property.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@vetequine/shared-types';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const repo = new PropertyRepository();

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

describe('PropertyRepository', () => {
  beforeAll(async () => {
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Property Repo Test', slug: 'property-repo-test', plan: 'basic', status: 'active' },
    });
  });

  afterEach(async () => {
    await admin.propertyOwner.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.property.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.owner.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('create() com endereço completo fica active', async () => {
    const created = await repo.create(
      ctx,
      { name: 'Fazenda Completa', address: 'Rodovia GO-184', city: 'Jataí', state: 'GO' },
      null,
    );
    expect(created.status).toBe('active');
  });

  it('create() só com nome fica pending (RN-006)', async () => {
    const created = await repo.create(ctx, { name: 'Fazenda Parcial' }, null);
    expect(created.status).toBe('pending');
  });

  it('create() grava as coordenadas resolvidas pelo GeoService', async () => {
    const created = await repo.create(
      ctx,
      { name: 'Fazenda com GPS', address: 'Rodovia GO-184', city: 'Jataí', state: 'GO' },
      { latitude: -17.88, longitude: -51.71 },
    );
    expect(created.latitude).toBe(-17.88);
    expect(created.longitude).toBe(-51.71);
  });

  it('findById() só encontra dentro do próprio tenant (RLS)', async () => {
    const created = await repo.create(ctx, { name: 'Isolada' }, null);

    const found = await repo.findById(ctx, created.id);
    expect(found?.id).toBe(created.id);

    const outroTenant: RequestContext = { ...ctx, tenantId: '00000000-0000-0000-0000-000000000000' };
    await expect(repo.findById(outroTenant, created.id)).resolves.toBeNull();
  });

  it('create() com ownerIds cria as linhas em property_owners, o primeiro é isPrimary', async () => {
    const owner1 = await admin.owner.create({ data: { tenantId: TENANT_ID, fullName: 'Dono 1', status: 'active' } });
    const owner2 = await admin.owner.create({ data: { tenantId: TENANT_ID, fullName: 'Dono 2', status: 'active' } });

    const created = await repo.create(ctx, { name: 'Fazenda Compartilhada', ownerIds: [owner1.id, owner2.id] }, null);

    const links = await admin.propertyOwner.findMany({ where: { propertyId: created.id }, orderBy: { createdAt: 'asc' } });
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.ownerId === owner1.id)?.isPrimary).toBe(true);
    expect(links.find((l) => l.ownerId === owner2.id)?.isPrimary).toBe(false);
  });

  it('list() filtra por ownerId', async () => {
    const owner = await admin.owner.create({ data: { tenantId: TENANT_ID, fullName: 'Dono Filtro', status: 'active' } });
    const comDono = await repo.create(ctx, { name: 'Com Dono', ownerIds: [owner.id] }, null);
    await repo.create(ctx, { name: 'Sem Dono' }, null);

    const result = await repo.list(ctx, { page: 1, limit: 20, status: 'all', ownerId: owner.id });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe(comDono.id);
  });

  it('update() extrai ownerIds sem quebrar (não é coluna do Prisma) e atualiza os demais campos', async () => {
    const created = await repo.create(ctx, { name: 'Original' }, null);

    const updated = await repo.update(ctx, created.id, { name: 'Alterado', ownerIds: ['ignora-isso'] }, null);

    expect(updated.name).toBe('Alterado');
  });

  it('softDelete() marca deletedAt e some das buscas, sem apagar fisicamente (LGPD)', async () => {
    const created = await repo.create(ctx, { name: 'Pra Deletar' }, null);

    await repo.softDelete(ctx, created.id);

    await expect(repo.findById(ctx, created.id)).resolves.toBeNull();
    const stillInDb = await admin.property.findUnique({ where: { id: created.id } });
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();
  });
});
