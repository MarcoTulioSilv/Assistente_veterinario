/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do AlertConfigRepository
 *
 * POR QUE ESTE TESTE EXISTE: cobre o ciclo dispara → não duplica →
 * normaliza → reseta (RF-EST-004/005), a constraint
 * @@unique([productId, alertType]) evitando duas linhas pro mesmo par,
 * e roda como quironequine_app (RLS ativo), igual ao runtime real.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/client-inventory';
import { ProductRepository } from '../src/repositories/product.repository';
import { AlertConfigRepository } from '../src/repositories/alert-config.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@quironequine/shared-types';

const TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_INVENTORY'] });
const products = new ProductRepository();
const alerts = new AlertConfigRepository();

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

describe('AlertConfigRepository', () => {
  afterEach(async () => {
    await admin.alertConfig.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.product.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('findByProductAndType() retorna null quando nunca disparou', async () => {
    const product = await products.create(ctx, { name: 'Produto Alerta', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    await expect(alerts.findByProductAndType(ctx, product.id, 'low_stock')).resolves.toBeNull();
  });

  it('markTriggered() cria a linha na primeira vez e atualiza numa segunda chamada (upsert)', async () => {
    const product = await products.create(ctx, { name: 'Produto Alerta', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    await alerts.markTriggered(ctx, product.id, 'low_stock');
    const first = await alerts.findByProductAndType(ctx, product.id, 'low_stock');
    expect(first?.lastTriggeredAt).not.toBeNull();

    await alerts.markTriggered(ctx, product.id, 'low_stock');
    const rows = await admin.alertConfig.findMany({ where: { productId: product.id, alertType: 'low_stock' } });
    expect(rows).toHaveLength(1); // upsert, não duplica (constraint @@unique)
  });

  it('clearTriggered() reseta lastTriggeredAt pra null', async () => {
    const product = await products.create(ctx, { name: 'Produto Alerta', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    await alerts.markTriggered(ctx, product.id, 'expiry');
    await alerts.clearTriggered(ctx, product.id, 'expiry');

    const config = await alerts.findByProductAndType(ctx, product.id, 'expiry');
    expect(config?.lastTriggeredAt).toBeNull();
  });

  it('expiry e low_stock são rastreados independentemente pro mesmo produto (constraint por par)', async () => {
    const product = await products.create(ctx, { name: 'Produto Alerta', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    await alerts.markTriggered(ctx, product.id, 'expiry');

    await expect(alerts.findByProductAndType(ctx, product.id, 'low_stock')).resolves.toBeNull();
    await expect(alerts.findByProductAndType(ctx, product.id, 'expiry')).resolves.not.toBeNull();
  });

  it('findByProductAndType() só encontra dentro do próprio tenant (RLS)', async () => {
    const product = await products.create(ctx, { name: 'Produto Alerta', unit: 'unidade', costPriceCents: 100, category: 'supply' });
    await alerts.markTriggered(ctx, product.id, 'low_stock');

    const outroTenant: RequestContext = { ...ctx, tenantId: '00000000-0000-0000-0000-000000000000' };
    await expect(alerts.findByProductAndType(outroTenant, product.id, 'low_stock')).resolves.toBeNull();
  });
});
