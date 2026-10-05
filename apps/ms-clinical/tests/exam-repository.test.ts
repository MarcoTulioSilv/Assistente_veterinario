/**
 * Integração do ExamService/Repository contra Postgres de verdade.
 *
 * O que só um teste assim prova:
 *  - que a coleta grava pedido, insumos e eventos no outbox na MESMA
 *    transação, e que o total congelado sai do pedido travado;
 *  - que fechar a cobrança duas vezes (corrida) não gera evento dobrado;
 *  - que o RLS isola pedidos e tipos entre tenants;
 *  - que a função SECURITY DEFINER do lembrete enxerga todos os tenants e
 *    ignora o que não deve lembrar;
 *  - que listByAnimal filtra pela tabela de animais do pedido.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext, ExamType } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { ExamRepository } from '../src/repositories/exam.repository';
import { ExamTypeRepository } from '../src/repositories/exam-type.repository';
import { ExamService } from '../src/services/exam.service';
import { ExamTypeService } from '../src/services/exam-type.service';
import type { CreateExamRequestInput } from '../src/schemas/exam.schema';

const TENANT_A = '99999999-9999-9999-9999-999999999999';
const TENANT_B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}

const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const repo = new ExamRepository();
const typeRepo = new ExamTypeRepository();
const service = new ExamService(repo, typeRepo);
const typeService = new ExamTypeService(typeRepo);

const COLLECTION = {
  material: 'Sangue',
  collectedAt: '2026-10-01T10:00:00.000Z',
  laborCents: 8000,
  displacementKm: 30,
  displacementRateCents: 200,
};

async function novoTipo(ctx: RequestContext, overrides: Partial<ExamType> = {}): Promise<ExamType> {
  return typeService.create(ctx, {
    name: 'Mormo',
    defaultPriceCents: 15000,
    expectedTurnaroundDays: 5,
    protocolFields: [{ key: 'laboratorio', label: 'Laboratório', type: 'text', required: true }],
    ...overrides,
  });
}

async function pedidoEmitido(
  ctx: RequestContext,
  overrides: Partial<CreateExamRequestInput> = {},
): Promise<{ id: string; animalIds: string[] }> {
  const tipo = await novoTipo(ctx);
  const criado = await service.create(ctx, {
    ownerId: randomUUID(),
    propertyId: randomUUID(),
    veterinarianId: randomUUID(),
    examTypeId: tipo.id,
    protocolData: { laboratorio: 'LANAGRO' },
    animalIds: [randomUUID(), randomUUID()],
    ...overrides,
  });
  await service.issue(ctx, criado.id);
  return criado;
}

async function eventosDe(tenantId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) => tx.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }));
  return rows.map((row) => row.eventName);
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await withTenant(tenantId, async (tx) => {
      await tx.outboxEvent.deleteMany({});
      await tx.examRequestItem.deleteMany({});
      await tx.examRequestAnimal.deleteMany({});
      await tx.examRequest.deleteMany({});
      await tx.examType.deleteMany({});
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ExamService.registerCollection — atomicidade (ADR-002)', () => {
  it('caso 1: grava coleta, insumos, total congelado e os dois eventos juntos', async () => {
    const pedido = await pedidoEmitido(ctxA);
    const productId = randomUUID();

    const coletado = await service.registerCollection(ctxA, pedido.id, {
      ...COLLECTION,
      items: [{ productId, description: 'Tubo', quantity: 2, unitPriceCents: 500 }],
    });

    expect(coletado.status).toBe('collected');
    expect(coletado.totalCents).toBe(44000);
    expect(coletado.chargedAt).not.toBeNull();
    expect(coletado.expectedResultAt).toBe('2026-10-06T10:00:00.000Z');
    expect(coletado.displacementKm).toBe(30);
    expect(coletado.items).toEqual([
      expect.objectContaining({ productId, quantity: 2, unitPriceCents: 500, totalCents: 1000 }),
    ]);
    expect(await eventosDe(TENANT_A)).toEqual(['exam.collected', 'exam.charged']);
  });

  it('caso 2: cliente pagou o laboratório — cobra mão de obra + km + insumos', async () => {
    const pedido = await pedidoEmitido(ctxA, { paidDirectlyByClient: true });

    const coletado = await service.registerCollection(ctxA, pedido.id, {
      ...COLLECTION,
      items: [{ productId: randomUUID(), description: 'Tubo', quantity: 2, unitPriceCents: 500 }],
    });

    expect(coletado.totalCents).toBe(15000);
  });

  it('o total usa o preço gravado no momento da coleta, não o lido antes', async () => {
    const pedido = await pedidoEmitido(ctxA);
    await service.update(ctxA, pedido.id, { unitPriceCents: 20000 });

    const coletado = await service.registerCollection(ctxA, pedido.id, COLLECTION);

    expect(coletado.totalCents).toBe(2 * 20000 + 8000 + 6000);
  });

  it('coleta e envio ao laboratório em paralelo: só uma fecha a cobrança', async () => {
    const pedido = await pedidoEmitido(ctxA);

    const resultados = await Promise.allSettled([
      service.registerCollection(ctxA, pedido.id, COLLECTION),
      service.sendToAnalysis(ctxA, pedido.id),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await eventosDe(TENANT_A)).filter((name) => name === 'exam.charged')).toHaveLength(1);
  });

  it('depois da cobrança fechada, o pedido não edita mais', async () => {
    const pedido = await pedidoEmitido(ctxA);
    await service.registerCollection(ctxA, pedido.id, COLLECTION);

    await expect(service.update(ctxA, pedido.id, { unitPriceCents: 1 })).rejects.toThrow(/cobrança já fechou/);
  });
});

describe('ExamService — sem coleta do veterinário', () => {
  it('caso 3: cliente pagou o laboratório e ninguém do vet coletou — fecha em 0, sem evento', async () => {
    const pedido = await pedidoEmitido(ctxA, { paidDirectlyByClient: true });

    const enviado = await service.sendToAnalysis(ctxA, pedido.id);

    expect(enviado.status).toBe('in_analysis');
    expect(enviado.totalCents).toBe(0);
    expect(enviado.chargedAt).not.toBeNull();
    expect(enviado.expectedResultAt).not.toBeNull();
    expect(await eventosDe(TENANT_A)).toEqual([]);
  });

  it('caso 4: vet cobra o exame sem ter coletado — só o procedimento', async () => {
    const pedido = await pedidoEmitido(ctxA);

    const comLaudo = await service.attachResult(ctxA, pedido.id, 'https://arquivos.exemplo/laudo.pdf');

    expect(comLaudo.status).toBe('result_available');
    expect(comLaudo.totalCents).toBe(30000);
    expect(await eventosDe(TENANT_A)).toEqual(['exam.charged']);
  });
});

describe('ExamService.softDelete', () => {
  it('pedido com pendência publica exam.deleted junto com a exclusão', async () => {
    const pedido = await pedidoEmitido(ctxA);
    await service.registerCollection(ctxA, pedido.id, COLLECTION);

    await service.softDelete(ctxA, pedido.id);

    expect(await service.findById(ctxA, pedido.id)).toBeNull();
    expect(await eventosDe(TENANT_A)).toEqual(['exam.charged', 'exam.deleted']);
  });

  it('rascunho some sem evento', async () => {
    const tipo = await novoTipo(ctxA);
    const criado = await service.create(ctxA, {
      ownerId: randomUUID(),
      propertyId: randomUUID(),
      veterinarianId: randomUUID(),
      examTypeId: tipo.id,
    });

    await service.softDelete(ctxA, criado.id);

    expect(await eventosDe(TENANT_A)).toEqual([]);
  });
});

describe('RLS e consultas', () => {
  it('outro tenant não vê o pedido nem o tipo', async () => {
    const pedido = await pedidoEmitido(ctxA);

    expect(await service.findById(ctxB, pedido.id)).toBeNull();
    expect((await typeService.list(ctxB, { page: 1, limit: 50 })).data).toEqual([]);
  });

  it('listByAnimal acha o pedido pelo animal; pedido só de lote não aparece', async () => {
    const pedido = await pedidoEmitido(ctxA);
    await pedidoEmitido(ctxA, { animalIds: [], lotDescription: 'Potros 2025', lotSize: 12 });

    const doAnimal = await service.listByAnimal(ctxA, pedido.animalIds[0]!, { page: 1, limit: 20 });

    expect(doAnimal.data.map((e) => e.id)).toEqual([pedido.id]);
  });
});

describe('clinical_list_exams_result_due (lembrete D-1/no dia)', () => {
  it('enxerga pedidos de vários tenants e ignora laudo anexado e pedido excluído', async () => {
    const a = await pedidoEmitido(ctxA);
    const b = await pedidoEmitido(ctxB);
    const comLaudo = await pedidoEmitido(ctxA);
    const excluido = await pedidoEmitido(ctxA);
    for (const [ctx, id] of [
      [ctxA, a.id],
      [ctxB, b.id],
      [ctxA, comLaudo.id],
      [ctxA, excluido.id],
    ] as const) {
      await service.registerCollection(ctx, id, COLLECTION);
    }
    await service.attachResult(ctxA, comLaudo.id, 'https://arquivos.exemplo/laudo.pdf');
    await service.softDelete(ctxA, excluido.id);

    const due = await repo.listResultDueAcrossTenants(
      new Date('2026-10-05T00:00:00.000Z'),
      new Date('2026-10-08T00:00:00.000Z'),
    );

    expect(due.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
    expect(due.find((row) => row.id === b.id)?.tenantId).toBe(TENANT_B);
    expect(due[0]?.expectedResultAt.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('fora da janela não volta', async () => {
    const pedido = await pedidoEmitido(ctxA);
    await service.registerCollection(ctxA, pedido.id, COLLECTION);

    const due = await repo.listResultDueAcrossTenants(
      new Date('2026-10-10T00:00:00.000Z'),
      new Date('2026-10-12T00:00:00.000Z'),
    );

    expect(due).toEqual([]);
  });
});
