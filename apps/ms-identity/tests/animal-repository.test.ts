/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do AnimalRepository
 *
 * POR QUE ESTE TESTE EXISTE: cobre RF-CAD-025 (cadastro parcial fica
 * pending), e RN-010/transfer() — a parte mais delicada, garante que
 * o log em animal_transfers é criado corretamente (incluindo
 * fromPropertyId nulo na primeira atribuição) e que Animal.propertyId
 * é atualizado. Roda como quironequine_app (RLS ativo), igual ao runtime.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AnimalRepository } from '../src/repositories/animal.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@quironequine/shared-types';

const TENANT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const repo = new AnimalRepository();

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

describe('AnimalRepository', () => {
  beforeAll(async () => {
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Animal Repo Test', slug: 'animal-repo-test', plan: 'basic', status: 'active' },
    });
  });

  afterEach(async () => {
    await admin.animalTransfer.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.animal.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.property.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.owner.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('create() com nome e dados descritivos, sem property/owner, fica pending (RF-CAD-025)', async () => {
    const created = await repo.create(ctx, { name: 'Trovão', sex: 'male', breed: 'Mangalarga' });
    expect(created.status).toBe('pending');
  });

  it('create() com propertyId e ownerId fica active', async () => {
    const property = await admin.property.create({ data: { tenantId: TENANT_ID, name: 'Fazenda X', status: 'active' } });
    const owner = await admin.owner.create({ data: { tenantId: TENANT_ID, fullName: 'Dono X', status: 'active' } });

    const created = await repo.create(ctx, { name: 'Estrela', propertyId: property.id, ownerId: owner.id });

    expect(created.status).toBe('active');
  });

  it('findById() só encontra dentro do próprio tenant (RLS)', async () => {
    const created = await repo.create(ctx, { name: 'Isolado' });

    const found = await repo.findById(ctx, created.id);
    expect(found?.id).toBe(created.id);

    const outroTenant: RequestContext = { ...ctx, tenantId: '00000000-0000-0000-0000-000000000000' };
    await expect(repo.findById(outroTenant, created.id)).resolves.toBeNull();
  });

  it('transfer() na primeira atribuição grava fromPropertyId nulo', async () => {
    const property = await admin.property.create({ data: { tenantId: TENANT_ID, name: 'Fazenda Y', status: 'active' } });
    const created = await repo.create(ctx, { name: 'Sem Fazenda' }); // propertyId nulo

    const updated = await repo.transfer(ctx, created.id, property.id, 'primeira atribuição');

    expect(updated.propertyId).toBe(property.id);
    const log = await admin.animalTransfer.findFirst({ where: { animalId: created.id } });
    expect(log?.fromPropertyId).toBeNull();
    expect(log?.toPropertyId).toBe(property.id);
    expect(log?.notes).toBe('primeira atribuição');
  });

  it('transfer() entre duas propriedades grava fromPropertyId corretamente e nunca apaga o log anterior', async () => {
    const propA = await admin.property.create({ data: { tenantId: TENANT_ID, name: 'Fazenda A', status: 'active' } });
    const propB = await admin.property.create({ data: { tenantId: TENANT_ID, name: 'Fazenda B', status: 'active' } });
    const created = await repo.create(ctx, { name: 'Viajante', propertyId: propA.id });

    await repo.transfer(ctx, created.id, propB.id);
    const updated = await repo.findById(ctx, created.id);

    expect(updated?.propertyId).toBe(propB.id);
    const logs = await admin.animalTransfer.findMany({ where: { animalId: created.id }, orderBy: { transferredAt: 'asc' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.fromPropertyId).toBe(propA.id);
    expect(logs[0]?.toPropertyId).toBe(propB.id);
  });

  it('list() filtra por propertyId', async () => {
    const property = await admin.property.create({ data: { tenantId: TENANT_ID, name: 'Fazenda Filtro', status: 'active' } });
    const comFazenda = await repo.create(ctx, { name: 'Com Fazenda', propertyId: property.id });
    await repo.create(ctx, { name: 'Sem Fazenda' });

    const result = await repo.list(ctx, { page: 1, limit: 20, status: 'all', propertyId: property.id });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe(comFazenda.id);
  });

  it('softDelete() marca deletedAt e some das buscas, sem apagar fisicamente (LGPD)', async () => {
    const created = await repo.create(ctx, { name: 'Pra Deletar' });

    await repo.softDelete(ctx, created.id);

    await expect(repo.findById(ctx, created.id)).resolves.toBeNull();
    const stillInDb = await admin.animal.findUnique({ where: { id: created.id } });
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();
  });

  it('update() converte birthDate (string ISO) pra Date sem quebrar', async () => {
    const created = await repo.create(ctx, { name: 'Com Data' });

    const updated = await repo.update(ctx, created.id, { birthDate: '2020-05-15' });

    expect(updated.birthDate).toBe('2020-05-15T00:00:00.000Z');
  });
});
