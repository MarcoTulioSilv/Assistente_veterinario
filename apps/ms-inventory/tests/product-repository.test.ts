/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do ProductRepository + MovementRepository
 *
 * POR QUE ESTE TESTE EXISTE: cobre RN-004 (sale_price_cents calculado
 * pelo Postgres, não em código), RF-EST-007 (estoque inicial > 0 gera
 * StockMovement de entrada), o cálculo de isNearExpiry/isLowStock na
 * leitura, RLS (roda como vetequine_app, igual ao runtime real), e a
 * idempotência de verdade do deduct() via UNIQUE(idempotency_key) —
 * chamar duas vezes com a mesma chave não pode descontar em dobro.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/client-inventory';
import { ProductRepository } from '../src/repositories/product.repository';
import { MovementRepository } from '../src/repositories/movement.repository';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@vetequine/shared-types';

// UUID dedicado a este teste — diferente do usado em prisma/seed.ts
// (aaaaaaaa-...), pra afterEach não apagar os dados de seed local.
const TENANT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_INVENTORY'] });
const products = new ProductRepository();
const movements = new MovementRepository();

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

describe('ProductRepository + MovementRepository', () => {
  afterEach(async () => {
    await admin.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.product.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('sale_price_cents é calculado pelo Postgres conforme RN-004', async () => {
    const created = await products.create(ctx, {
      name: 'Produto Preço',
      unit: 'unidade',
      costPriceCents: 1000,
      markupPercent: 25,
      category: 'supply',
    });

    expect(created.salePriceCents).toBe(1250);
  });

  it('create() com quantityInStock inicial gera um StockMovement de entrada (RF-EST-007)', async () => {
    const created = await products.create(ctx, {
      name: 'Produto Com Estoque',
      unit: 'unidade',
      quantityInStock: 15,
      costPriceCents: 500,
      category: 'supply',
    });

    const rows = await admin.stockMovement.findMany({ where: { productId: created.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('in');
    expect(rows[0]?.reason).toBe('purchase');
    expect(rows[0]?.quantity.toNumber()).toBe(15);
  });

  it('create() sem quantityInStock não gera StockMovement', async () => {
    const created = await products.create(ctx, {
      name: 'Produto Sem Estoque',
      unit: 'unidade',
      costPriceCents: 500,
      category: 'supply',
    });

    const rows = await admin.stockMovement.findMany({ where: { productId: created.id } });
    expect(rows).toHaveLength(0);
  });

  it('findById() só encontra dentro do próprio tenant (RLS)', async () => {
    const created = await products.create(ctx, { name: 'Isolado', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    const found = await products.findById(ctx, created.id);
    expect(found?.id).toBe(created.id);

    const outroTenant: RequestContext = { ...ctx, tenantId: '00000000-0000-0000-0000-000000000000' };
    await expect(products.findById(outroTenant, created.id)).resolves.toBeNull();
  });

  it('softDelete() marca deletedAt e some das buscas, sem apagar fisicamente (LGPD)', async () => {
    const created = await products.create(ctx, { name: 'Pra Deletar', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    await products.softDelete(ctx, created.id);

    await expect(products.findById(ctx, created.id)).resolves.toBeNull();
    const stillInDb = await admin.product.findUnique({ where: { id: created.id } });
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();
  });

  it('list() filtra por categoria e busca por nome (case-insensitive)', async () => {
    await products.create(ctx, { name: 'Vacina Raiva', unit: 'frasco', costPriceCents: 100, category: 'vaccine' });
    await products.create(ctx, { name: 'Seringa 5ml', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    const porCategoria = await products.list(ctx, { page: 1, limit: 20, category: 'vaccine' });
    expect(porCategoria.data).toHaveLength(1);
    expect(porCategoria.data[0]?.name).toBe('Vacina Raiva');

    const porBusca = await products.list(ctx, { page: 1, limit: 20, search: 'vacina' });
    expect(porBusca.data).toHaveLength(1);
    expect(porBusca.data[0]?.name).toBe('Vacina Raiva');

    const todos = await products.list(ctx, { page: 1, limit: 20 });
    expect(todos.pagination.total).toBe(2);
  });

  it('update() altera campos e converte expiryDate de string ISO pra Date', async () => {
    const created = await products.create(ctx, { name: 'Original', unit: 'unidade', costPriceCents: 100, category: 'supply' });

    const updated = await products.update(ctx, created.id, { name: 'Atualizado', expiryDate: '2027-01-01' });

    expect(updated.name).toBe('Atualizado');
    expect(updated.expiryDate).toBe('2027-01-01T00:00:00.000Z');
  });

  it('isLowStock e isNearExpiry são calculados na leitura, não são colunas', async () => {
    const daqui10Dias = new Date();
    daqui10Dias.setDate(daqui10Dias.getDate() + 10);

    const created = await products.create(ctx, {
      name: 'Perto de Vencer e Baixo Estoque',
      unit: 'unidade',
      costPriceCents: 100,
      category: 'medication',
      quantityInStock: 1,
      minStockQty: 5,
      expiryDate: daqui10Dias.toISOString().slice(0, 10),
      alertDaysBefore: 30,
    });

    expect(created.isLowStock).toBe(true);
    expect(created.isNearExpiry).toBe(true);
  });

  describe('MovementRepository.record()', () => {
    it('registra a movimentação e ajusta quantityInStock atomicamente', async () => {
      const product = await products.create(ctx, {
        name: 'Estoque Base', unit: 'unidade', quantityInStock: 10, costPriceCents: 100, category: 'supply',
      });

      await movements.record(ctx, product.id, { type: 'out', quantity: 4, reason: 'manual' });

      const updated = await products.findById(ctx, product.id);
      expect(updated?.quantityInStock).toBe(6);
    });

    it('é idempotente de verdade contra o banco: mesma idempotencyKey não desconta duas vezes (UNIQUE)', async () => {
      const product = await products.create(ctx, {
        name: 'Produto Idempotência', unit: 'unidade', quantityInStock: 10, costPriceCents: 100, category: 'supply',
      });
      const idempotencyKey = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

      await movements.record(ctx, product.id, { type: 'out', quantity: 3, reason: 'appointment', idempotencyKey });
      await movements.record(ctx, product.id, { type: 'out', quantity: 3, reason: 'appointment', idempotencyKey });

      const updated = await products.findById(ctx, product.id);
      expect(updated?.quantityInStock).toBe(7);

      // 1 linha da entrada inicial (create com quantityInStock=10) + 1 da
      // saída — a segunda chamada com a mesma idempotencyKey não gera linha.
      const rows = await admin.stockMovement.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.type === 'out')).toHaveLength(1);
    });
  });

  describe('MovementRepository.list()', () => {
    it('lista as movimentações do produto, mais recente primeiro', async () => {
      const product = await products.create(ctx, { name: 'Produto Histórico', unit: 'unidade', quantityInStock: 10, costPriceCents: 100, category: 'supply' });

      await movements.record(ctx, product.id, { type: 'out', quantity: 2, reason: 'manual' });
      await movements.record(ctx, product.id, { type: 'out', quantity: 1, reason: 'manual' });

      const result = await movements.list(ctx, product.id, { page: 1, limit: 20 });

      expect(result.total).toBe(3); // entrada inicial + 2 saídas
      expect(result.data[0]?.quantity).toBe(1); // a mais recente vem primeiro
    });
  });
});
