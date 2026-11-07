/**
 * ══════════════════════════════════════════════════════════════════
 * Referências entre tenants (auditoria 06/11/2026, M-01)
 *
 * POR QUE ESTE TESTE EXISTE: o Postgres confere chave estrangeira sem
 * passar pelo RLS. Antes das FKs compostas, o tenant A conseguia criar um
 * animal "na propriedade" do tenant B só sabendo o UUID. Aqui ficam as duas
 * barreiras: o repositório responde 404 (sem dizer se o ID existe em outro
 * tenant) e o banco recusa mesmo se o repositório for contornado.
 * Roda como quironequine_app (RLS ativo), igual ao runtime.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AppError } from '@quironequine/shared-middlewares';
import type { RequestContext } from '@quironequine/shared-types';
import { AnimalRepository } from '../src/repositories/animal.repository';
import { PropertyRepository } from '../src/repositories/property.repository';
import { prisma as appPrisma, withTenant } from '../src/prisma';

const TENANT_A = 'e1e1e1e1-0000-4000-8000-000000000001';
const TENANT_B = 'e1e1e1e1-0000-4000-8000-000000000002';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const animals = new AnimalRepository();
const properties = new PropertyRepository();

const ctxA: RequestContext = {
  tenantId: TENANT_A,
  userId: 'e1e1e1e1-0000-4000-8000-0000000000aa',
  role: 'admin',
  plan: 'plus',
  traceId: 'test-trace',
};

/** IDs criados no tenant B: o que o tenant A tenta usar. */
let propertyB: string;
let ownerB: string;
/** Do próprio tenant A, para os casos válidos. */
let propertyA: string;
let ownerA: string;

async function cleanup(): Promise<void> {
  const tenantId = { in: [TENANT_A, TENANT_B] };
  await admin.animalTransfer.deleteMany({ where: { tenantId } });
  await admin.animal.deleteMany({ where: { tenantId } });
  await admin.propertyOwner.deleteMany({ where: { tenantId } });
  await admin.property.deleteMany({ where: { tenantId } });
  await admin.owner.deleteMany({ where: { tenantId } });
  await admin.auditLog.deleteMany({ where: { tenantId: tenantId } });
  await admin.tenant.deleteMany({ where: { id: tenantId } });
}

/** O AppError de 404 que o repositório lança, com a mensagem esperada. */
function notFound(message: string) {
  return expect.objectContaining({ statusCode: 404, message }) as unknown as AppError;
}

describe('M-01 — referência a registro de outro tenant', () => {
  beforeAll(async () => {
    await cleanup();
    await admin.tenant.createMany({
      data: [
        { id: TENANT_A, name: 'Clinica A', slug: 'm01-test-a', plan: 'plus', status: 'active' },
        { id: TENANT_B, name: 'Clinica B', slug: 'm01-test-b', plan: 'plus', status: 'active' },
      ],
    });
    propertyB = (await admin.property.create({ data: { tenantId: TENANT_B, name: 'Fazenda B' } }))
      .id;
    ownerB = (await admin.owner.create({ data: { tenantId: TENANT_B, fullName: 'Dono B' } })).id;
    propertyA = (await admin.property.create({ data: { tenantId: TENANT_A, name: 'Fazenda A' } }))
      .id;
    ownerA = (await admin.owner.create({ data: { tenantId: TENANT_A, fullName: 'Dono A' } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  describe('repositório: 404, sem gravar nada', () => {
    it('criar animal com a propriedade de B', async () => {
      await expect(
        animals.create(ctxA, { name: 'Intruso', propertyId: propertyB }),
      ).rejects.toEqual(notFound('Propriedade não encontrada'));
      expect(await admin.animal.count({ where: { tenantId: TENANT_A, name: 'Intruso' } })).toBe(0);
    });

    it('criar animal com o proprietário de B', async () => {
      await expect(animals.create(ctxA, { name: 'Intruso', ownerId: ownerB })).rejects.toEqual(
        notFound('Proprietário não encontrado'),
      );
    });

    it('editar animal apontando para a propriedade ou o proprietário de B', async () => {
      const own = await animals.create(ctxA, {
        name: 'Meu',
        propertyId: propertyA,
        ownerId: ownerA,
      });

      await expect(animals.update(ctxA, own.id, { propertyId: propertyB })).rejects.toEqual(
        notFound('Propriedade não encontrada'),
      );
      await expect(animals.update(ctxA, own.id, { ownerId: ownerB })).rejects.toEqual(
        notFound('Proprietário não encontrado'),
      );
      const row = await admin.animal.findUniqueOrThrow({ where: { id: own.id } });
      expect(row.propertyId).toBe(propertyA);
      expect(row.ownerId).toBe(ownerA);
    });

    it('transferir animal para a propriedade de B não grava o log de transferência', async () => {
      const own = await animals.create(ctxA, { name: 'Viajante', propertyId: propertyA });

      await expect(animals.transfer(ctxA, own.id, propertyB)).rejects.toEqual(
        notFound('Propriedade não encontrada'),
      );
      expect(await admin.animalTransfer.count({ where: { animalId: own.id } })).toBe(0);
    });

    it('criar propriedade vinculada ao proprietário de B não deixa a propriedade criada', async () => {
      await expect(
        properties.create(ctxA, { name: 'Fazenda Mista', ownerIds: [ownerA, ownerB] }, null),
      ).rejects.toEqual(notFound('Proprietário não encontrado'));
      expect(
        await admin.property.count({ where: { tenantId: TENANT_A, name: 'Fazenda Mista' } }),
      ).toBe(0);
    });

    it('referência excluída (soft delete) também é 404', async () => {
      const gone = await admin.owner.create({
        data: { tenantId: TENANT_A, fullName: 'Excluído', deletedAt: new Date() },
      });
      await expect(animals.create(ctxA, { name: 'Órfão', ownerId: gone.id })).rejects.toEqual(
        notFound('Proprietário não encontrado'),
      );
    });

    it('caso válido: mesmo tenant e dono repetido na lista', async () => {
      const created = await properties.create(
        ctxA,
        { name: 'Fazenda Ok', ownerIds: [ownerA, ownerA] },
        null,
      );
      expect(await admin.propertyOwner.count({ where: { propertyId: created.id } })).toBe(1);
    });
  });

  describe('banco: a FK composta recusa mesmo sem passar pelo repositório', () => {
    // Prisma P2003 = violação de FK. Antes da migração fk_composta_tenant estes
    // inserts passavam, porque o UUID existe (no tenant B).
    it('animals.property_id de outro tenant', async () => {
      await expect(
        withTenant(TENANT_A, (tx) =>
          tx.animal.create({ data: { tenantId: TENANT_A, name: 'Direto', propertyId: propertyB } }),
        ),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('property_owners.owner_id de outro tenant', async () => {
      await expect(
        withTenant(TENANT_A, (tx) =>
          tx.propertyOwner.create({
            data: { tenantId: TENANT_A, propertyId: propertyA, ownerId: ownerB },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('animal_transfers.to_property_id de outro tenant', async () => {
      const own = await admin.animal.create({ data: { tenantId: TENANT_A, name: 'Direto 2' } });
      await expect(
        withTenant(TENANT_A, (tx) =>
          tx.animalTransfer.create({
            data: { tenantId: TENANT_A, animalId: own.id, toPropertyId: propertyB },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
