/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de integração do DeductionService + deduction-consumer
 *
 * POR QUE ESTE TESTE EXISTE: prova RN-003 de ponta a ponta — publica
 * um appointment.done sintético de verdade (publishDomainEvent, fila
 * BullMQ/Redis real), o worker real processa, e confere que o estoque
 * baixou e o StockMovement ficou com referenceType='appointment'.
 *
 * Idempotência é testada chamando o handler exportado direto duas
 * vezes com o MESMO evento (não publicando duas vezes pela fila) — só
 * assim se prova a idempotência por item que este serviço implementa;
 * publicar duas vezes só provaria o dedup de jobId do próprio BullMQ
 * (publisher.ts já usa idempotencyKey como jobId), uma camada mais
 * fraca e já garantida por outro código.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Worker, Job } from 'bullmq';
import { PrismaClient } from '../node_modules/.prisma/client-inventory';
import { ProductRepository } from '../src/repositories/product.repository';
import { MovementRepository } from '../src/repositories/movement.repository';
import { StockService } from '../src/services/stock.service';
import { DeductionService } from '../src/services/deduction.service';
import { startDeductionWorker } from '../src/events/deduction-consumer';
import { publishDomainEvent, closeEventsQueue } from '../src/events/publisher';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext, DomainEvent } from '@vetequine/shared-types';

// UUID dedicado a este teste — diferente dos usados nos outros testes
// de integração, pra afterEach não apagar dados de outro arquivo.
const TENANT_ID = '66666666-6666-6666-6666-666666666666';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_INVENTORY'] });
const products = new ProductRepository();
const movements = new MovementRepository();
const stockService = new StockService(products, movements);
const deductionService = new DeductionService(stockService);

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

let worker: Worker;

function buildEvent(consumedItems: Array<{ productId: string; quantity: number }>): {
  event: DomainEvent<unknown>;
  appointmentId: string;
} {
  const appointmentId = randomUUID();
  return {
    appointmentId,
    event: {
      name: 'appointment.done',
      tenantId: TENANT_ID,
      traceId: 'test-trace',
      idempotencyKey: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        appointmentId,
        ownerId: randomUUID(),
        totalCostCents: 1000,
        consumedItems,
      },
    },
  };
}

function waitForJob(w: Worker, jobId: string): Promise<Job> {
  return new Promise((resolve, reject) => {
    const onCompleted = (job: Job): void => {
      if (job.id === jobId) {
        cleanup();
        resolve(job);
      }
    };
    const onFailed = (job: Job | undefined, err: Error): void => {
      if (job?.id === jobId) {
        cleanup();
        reject(err);
      }
    };
    function cleanup(): void {
      w.off('completed', onCompleted);
      w.off('failed', onFailed);
    }
    w.on('completed', onCompleted);
    w.on('failed', onFailed);
  });
}

describe('DeductionService — consumidor real (Postgres + Redis)', () => {
  beforeAll(() => {
    worker = startDeductionWorker((job) => deductionService.handle(job.name, job.data as DomainEvent<unknown>));
  });

  afterEach(async () => {
    await admin.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.product.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await worker.close();
    await closeEventsQueue();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('publica appointment.done de verdade e o worker baixa o estoque', async () => {
    const product = await products.create(ctx, {
      name: 'Produto Dedução', unit: 'unidade', quantityInStock: 10, costPriceCents: 100, category: 'supply',
    });
    const { event, appointmentId } = buildEvent([{ productId: product.id, quantity: 3 }]);

    const completion = waitForJob(worker, event.idempotencyKey);
    await publishDomainEvent(event);
    await completion;

    const updated = await products.findById(ctx, product.id);
    expect(updated?.quantityInStock).toBe(7);

    // create() com quantityInStock inicial já gera sua própria linha "in"
    // (RF-EST-007) — filtra só a saída que a dedução deveria ter criado.
    const rows = await admin.stockMovement.findMany({ where: { productId: product.id, type: 'out' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('appointment');
    expect(rows[0]?.referenceType).toBe('appointment');
    expect(rows[0]?.referenceId).toBe(appointmentId);
  }, 15_000);

  it('evento com múltiplos itens (mesmo produto duas vezes) gera duas baixas separadas', async () => {
    const product = await products.create(ctx, {
      name: 'Produto Multi-Item', unit: 'unidade', quantityInStock: 20, costPriceCents: 100, category: 'supply',
    });
    const { event } = buildEvent([
      { productId: product.id, quantity: 2 },
      { productId: product.id, quantity: 5 },
    ]);

    const completion = waitForJob(worker, event.idempotencyKey);
    await publishDomainEvent(event);
    await completion;

    const updated = await products.findById(ctx, product.id);
    expect(updated?.quantityInStock).toBe(13); // 20 - 2 - 5

    const rows = await admin.stockMovement.findMany({ where: { productId: product.id, type: 'out' } });
    expect(rows).toHaveLength(2);
  }, 15_000);

  it('idempotente: reprocessar o mesmo evento (handler chamado direto duas vezes) não desconta de novo', async () => {
    const product = await products.create(ctx, {
      name: 'Produto Idempotência Dedução', unit: 'unidade', quantityInStock: 10, costPriceCents: 100, category: 'supply',
    });
    const { event } = buildEvent([{ productId: product.id, quantity: 4 }]);

    await deductionService.handle('appointment.done', event);
    await deductionService.handle('appointment.done', event);

    const updated = await products.findById(ctx, product.id);
    expect(updated?.quantityInStock).toBe(6); // só descontou uma vez

    const rows = await admin.stockMovement.findMany({ where: { productId: product.id, type: 'out' } });
    expect(rows).toHaveLength(1);
  });
});
