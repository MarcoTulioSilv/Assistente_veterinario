/**
 * FKs compostas por tenant (auditoria 06/11/2026, item 3).
 *
 * O Postgres confere FK sem RLS: antes desta migration, uma movimentação ou
 * um alerta da clínica A podia apontar para o produto da clínica B, desde
 * que o UUID existisse. Com (tenant_id, product_id) → products(tenant_id, id),
 * o próprio banco recusa — mesmo que um service esqueça de conferir.
 *
 * Roda com a conexão do runtime (quironequine_app), como em produção.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../node_modules/.prisma/client-inventory';
import { prisma, withTenant } from '../src/prisma';

const TENANT_A = 'c7000000-0000-0000-0000-000000000000';
const TENANT_B = 'c8000000-0000-0000-0000-000000000000';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_INVENTORY'] });

let productOfA: string;
let productOfB: string;

beforeAll(async () => {
  const data = { name: 'Vacina', unit: 'unidade', costPriceCents: 100, category: 'supply' } as const;
  productOfA = (await admin.product.create({ data: { ...data, tenantId: TENANT_A } })).id;
  productOfB = (await admin.product.create({ data: { ...data, tenantId: TENANT_B } })).id;
});

afterAll(async () => {
  // conexão de migração: a app não tem DELETE (M-06)
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await admin.stockMovement.deleteMany({ where: { tenantId } });
    await admin.alertConfig.deleteMany({ where: { tenantId } });
    await admin.product.deleteMany({ where: { tenantId } });
  }
  await admin.$disconnect();
  await prisma.$disconnect();
});

function movement(tenantId: string, productId: string) {
  return {
    tenantId,
    productId,
    type: 'in' as const,
    quantity: 1,
    reason: 'purchase' as const,
    idempotencyKey: randomUUID(),
  };
}

describe('FK composta: referência a produto de outra clínica é recusada pelo banco', () => {
  it('movimentação da clínica A apontando para o produto da clínica B', async () => {
    await expect(
      withTenant(TENANT_A, (tx) => tx.stockMovement.create({ data: movement(TENANT_A, productOfB) })),
    ).rejects.toThrow(/foreign key|Foreign key/);
  });

  it('alerta da clínica A apontando para o produto da clínica B', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.alertConfig.create({ data: { tenantId: TENANT_A, productId: productOfB, alertType: 'low_stock' } }),
      ),
    ).rejects.toThrow(/foreign key|Foreign key/);
  });

  it('a mesma gravação dentro da própria clínica passa', async () => {
    await expect(
      withTenant(TENANT_A, (tx) => tx.stockMovement.create({ data: movement(TENANT_A, productOfA) })),
    ).resolves.toMatchObject({ productId: productOfA });
  });
});
