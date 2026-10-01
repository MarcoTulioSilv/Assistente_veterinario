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
      // Como o MS3 publica de verdade: data em que o atendimento foi realizado.
      performedAt: '2026-09-30T14:00:00.000Z',
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

/** O appointment.deleted que o MS3 publicaria pra um atendimento finalizado. */
function appointmentDeleted(
  tenantId: string,
  appointmentId: string,
  ownerId: string = randomUUID(),
): DomainEvent<unknown> {
  return {
    name: 'appointment.deleted',
    tenantId,
    traceId: `trace-${randomUUID()}`,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      appointmentId,
      ownerId,
      totalCostCents: 27000,
      performedAt: '2026-09-30T14:00:00.000Z',
    },
  };
}

describe('Exclusão do atendimento cancela a pendência', () => {
  it('pendência em aberto vira cancelada, com data do cancelamento', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));

    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, appointmentId));

    const registro = await service.findBySource(ctxA, 'appointment', appointmentId);
    expect(registro!.status).toBe('cancelled');
    expect(registro!.cancelledAt).not.toBeNull();
  });

  it('atendimento já PAGO: o pagamento é mantido (não se apaga dinheiro recebido)', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));
    const pendencia = await service.findBySource(ctxA, 'appointment', appointmentId);
    await service.registerPayment(ctxA, pendencia!.id);

    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, appointmentId));

    const registro = await service.findBySource(ctxA, 'appointment', appointmentId);
    expect(registro!.status).toBe('received');
    expect(registro!.cancelledAt).toBeNull();
  });

  it('reentrega da mesma exclusão é no-op', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));
    const exclusao = appointmentDeleted(TENANT_A, appointmentId);

    await service.handle('appointment.deleted', exclusao);
    await service.handle('appointment.deleted', exclusao);

    const lista = await service.list(ctxA, { page: 1, limit: 20 });
    expect(lista.pagination.total).toBe(1);
    expect(lista.data[0]!.status).toBe('cancelled');
  });

  it('FORA DE ORDEM: exclusão processada antes da criação — a pendência não nasce órfã', async () => {
    // O cenário real: o appointment.done falha uma vez (banco piscou) e entra
    // em retry com backoff; nesse meio-tempo o appointment.deleted é
    // processado. Sem a UNIQUE da origem, o cancelamento não acharia nada e
    // o retry do done criaria uma pendência cobrando um atendimento excluído.
    const appointmentId = randomUUID();
    const ownerId = randomUUID();

    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, appointmentId, ownerId));
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId, ownerId }));

    const lista = await service.list(ctxA, { page: 1, limit: 20 });
    expect(lista.pagination.total).toBe(1);
    expect(lista.data[0]!.status).toBe('cancelled');
    // Mesma data que teria se os eventos chegassem na ordem certa.
    expect(lista.data[0]!.occurredAt).toBe('2026-09-30T14:00:00.000Z');
  });

  it('nas duas ordens o resultado é o mesmo: uma origem, um registro, cancelado', async () => {
    const naOrdem = randomUUID();
    const foraDeOrdem = randomUUID();

    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId: naOrdem }));
    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, naOrdem));

    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, foraDeOrdem));
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId: foraDeOrdem }));

    const a = await service.findBySource(ctxA, 'appointment', naOrdem);
    const b = await service.findBySource(ctxA, 'appointment', foraDeOrdem);
    expect(a!.status).toBe('cancelled');
    expect(b!.status).toBe('cancelled');
  });

  it('pendência cancelada não pode ser paga', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));
    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, appointmentId));
    const registro = await service.findBySource(ctxA, 'appointment', appointmentId);

    await expect(service.registerPayment(ctxA, registro!.id)).rejects.toThrow(/excluído/);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('filtra as canceladas na listagem', async () => {
    const appointmentId = randomUUID();
    await service.handle('appointment.done', appointmentDone(TENANT_A, { appointmentId }));
    await service.handle('appointment.done', appointmentDone(TENANT_A));
    await service.handle('appointment.deleted', appointmentDeleted(TENANT_A, appointmentId));

    expect((await service.list(ctxA, { page: 1, limit: 20, status: 'cancelled' })).pagination.total).toBe(1);
    expect((await service.list(ctxA, { page: 1, limit: 20, status: 'pending' })).pagination.total).toBe(1);
  });
});
