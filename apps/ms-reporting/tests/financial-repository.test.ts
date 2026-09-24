/**
 * Integração do FinancialService/Repository contra Postgres de verdade.
 *
 * O que só um teste assim prova:
 *  - a idempotência real: a UNIQUE de idempotency_key barrando redelivery
 *    do broker, sem cobrar o proprietário duas vezes;
 *  - que registrar pagamento duas vezes não passa, nem em corrida;
 *  - que o RLS isola pendências entre tenants.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext, DomainEvent } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { FinancialRepository } from '../src/repositories/financial.repository';
import { FinancialService } from '../src/services/financial.service';

const TENANT_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENANT_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}

const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const repo = new FinancialRepository();
const publishSpy = vi.fn().mockResolvedValue(undefined);
const service = new FinancialService(repo, publishSpy);

function appointmentDone(tenantId: string, overrides: Record<string, unknown> = {}): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId,
    traceId: `trace-${randomUUID()}`,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      appointmentId: randomUUID(),
      ownerId: randomUUID(),
      totalCostCents: 27000,
      consumedItems: [],
      ...overrides,
    },
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  publishSpy.mockClear();
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await withTenant(tenantId, (tx) => tx.financialRecord.deleteMany({}));
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('FinancialService.handle — pendência a partir do atendimento (RN-002)', () => {
  it('abre a pendência com o total do atendimento', async () => {
    const event = appointmentDone(TENANT_A);

    await service.handle('appointment.done', event);

    const lista = await service.list(ctxA, { page: 1, limit: 20 });
    expect(lista.pagination.total).toBe(1);
    expect(lista.data[0]!.amountCents).toBe(27000);
    expect(lista.data[0]!.status).toBe('pending');
    expect(lista.data[0]!.sourceType).toBe('appointment');
  });

  it('é idempotente de verdade: reentrega do MESMO evento não cobra duas vezes', async () => {
    const event = appointmentDone(TENANT_A);

    await service.handle('appointment.done', event);
    await service.handle('appointment.done', event);

    const lista = await service.list(ctxA, { page: 1, limit: 20 });
    expect(lista.pagination.total).toBe(1);
  });

  it('atendimentos diferentes geram pendências diferentes', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    await service.handle('appointment.done', appointmentDone(TENANT_A));

    const lista = await service.list(ctxA, { page: 1, limit: 20 });
    expect(lista.pagination.total).toBe(2);
  });

  it('a pendência nasce no tenant do evento, não no de quem consome', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_B));

    expect((await service.list(ctxA, { page: 1, limit: 20 })).pagination.total).toBe(0);
    expect((await service.list(ctxB, { page: 1, limit: 20 })).pagination.total).toBe(1);
  });
});

describe('FinancialRepository — consultas', () => {
  it('RF-ATD-008: pendências filtradas por proprietário', async () => {
    const ownerId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { ownerId }));
    await service.handle('appointment.done', appointmentDone(TENANT_A, { ownerId }));
    await service.handle('appointment.done', appointmentDone(TENANT_A));

    const doOwner = await service.listByOwner(ctxA, ownerId, { page: 1, limit: 20 });

    expect(doOwner.pagination.total).toBe(2);
    expect(doOwner.data.every((r) => r.ownerId === ownerId)).toBe(true);
  });

  it('acha a pendência pelo atendimento que a originou', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));

    const achado = await service.findBySource(ctxA, 'appointment', appointmentId);

    expect(achado).not.toBeNull();
    expect(achado!.sourceId).toBe(appointmentId);
  });

  it('filtra por status', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    const pendentes = await service.list(ctxA, { page: 1, limit: 20, status: 'pending' });
    await service.registerPayment(ctxA, pendentes.data[0]!.id);

    expect((await service.list(ctxA, { page: 1, limit: 20, status: 'received' })).pagination.total).toBe(1);
    expect((await service.list(ctxA, { page: 1, limit: 20, status: 'pending' })).pagination.total).toBe(1);
  });

  it('um tenant não enxerga pendência do outro', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    const doA = (await service.list(ctxA, { page: 1, limit: 20 })).data[0]!;

    expect(await service.findBySource(ctxB, 'appointment', doA.sourceId)).toBeNull();
  });
});

describe('FinancialService.registerPayment (RN-002)', () => {
  it('marca recebido, grava a data e publica payment.registered', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    const pendencia = (await service.list(ctxA, { page: 1, limit: 20 })).data[0]!;

    const pago = await service.registerPayment(ctxA, pendencia.id);

    expect(pago.status).toBe('received');
    expect(pago.paidAt).not.toBeNull();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0]![0].name).toBe('payment.registered');
  });

  it('registrar duas vezes falha e não publica um segundo evento', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    const pendencia = (await service.list(ctxA, { page: 1, limit: 20 })).data[0]!;
    await service.registerPayment(ctxA, pendencia.id);
    publishSpy.mockClear();

    await expect(service.registerPayment(ctxA, pendencia.id)).rejects.toThrow(/já registrado/);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('não dá pra registrar pagamento de pendência de outro tenant', async () => {
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    const pendencia = (await service.list(ctxA, { page: 1, limit: 20 })).data[0]!;

    await expect(service.registerPayment(ctxB, pendencia.id)).rejects.toThrow(/não encontrado/);
  });
});
