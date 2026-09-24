/**
 * Integração do outbox contra Postgres e Redis de verdade.
 *
 * O que só um teste assim prova:
 *  - a atomicidade (rollback da transação leva o evento junto) — o
 *    motivo inteiro do padrão existir;
 *  - que a função SECURITY DEFINER enxerga pendentes de qualquer tenant,
 *    com RLS ligada e a conexão de runtime (quironequine_app);
 *  - que o ciclo do relay publica no broker e marca a linha.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import {
  enqueueOutboxEvent,
  fetchPendingOutbox,
  markOutboxPublished,
  markOutboxFailed,
} from '../src/repositories/outbox.repository';
import { drainOutboxOnce } from '../src/services/outbox-relay.service';
import { publishDomainEvent, closeEventsQueue } from '../src/events/publisher';

const TENANT_A = '77777777-7777-7777-7777-777777777777';
const TENANT_B = '88888888-8888-8888-8888-888888888888';

function appointmentDone(tenantId: string): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId,
    traceId: `trace-${randomUUID()}`,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      appointmentId: randomUUID(),
      ownerId: randomUUID(),
      totalCostCents: 15000,
      consumedItems: [{ productId: randomUUID(), quantity: 1 }],
    },
  };
}

/** Cria um atendimento mínimo — a "mudança de negócio" da transação. */
async function novoAtendimento(tenantId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx.appointment.create({
      data: {
        id,
        tenantId,
        ownerId: randomUUID(),
        propertyId: randomUUID(),
        animalId: randomUUID(),
        veterinarianId: randomUUID(),
        type: 'clinico_geral',
        performedAt: new Date(),
      },
    }),
  );
  return id;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await withTenant(tenantId, async (tx) => {
      await tx.outboxEvent.deleteMany({});
      await tx.appointment.deleteMany({});
    });
  }
});

afterAll(async () => {
  await closeEventsQueue();
  await prisma.$disconnect();
});

describe('Outbox — atomicidade com a transação de negócio', () => {
  it('grava o evento junto com a mudança de negócio, na mesma transação', async () => {
    const event = appointmentDone(TENANT_A);
    const appointmentId = randomUUID();

    await withTenant(TENANT_A, async (tx) => {
      await tx.appointment.create({
        data: {
          id: appointmentId,
          tenantId: TENANT_A,
          ownerId: randomUUID(),
          propertyId: randomUUID(),
          animalId: randomUUID(),
          veterinarianId: randomUUID(),
          type: 'clinico_geral',
          performedAt: new Date(),
          status: 'finished',
        },
      });
      await enqueueOutboxEvent(tx, TENANT_A, event);
    });

    const pendentes = await fetchPendingOutbox(50);
    expect(pendentes.map((p) => p.event.idempotencyKey)).toContain(event.idempotencyKey);
  });

  it('se a transação falha, o evento NÃO fica no outbox — é isso que o padrão compra', async () => {
    const event = appointmentDone(TENANT_A);

    await expect(
      withTenant(TENANT_A, async (tx) => {
        await tx.appointment.create({
          data: {
            id: randomUUID(),
            tenantId: TENANT_A,
            ownerId: randomUUID(),
            propertyId: randomUUID(),
            animalId: randomUUID(),
            veterinarianId: randomUUID(),
            type: 'clinico_geral',
            performedAt: new Date(),
          },
        });
        await enqueueOutboxEvent(tx, TENANT_A, event);
        throw new Error('falha depois de gravar os dois');
      }),
    ).rejects.toThrow(/falha depois de gravar/);

    const pendentes = await fetchPendingOutbox(50);
    expect(pendentes.map((p) => p.event.idempotencyKey)).not.toContain(event.idempotencyKey);

    // E o atendimento também não ficou — os dois voltaram juntos.
    const atendimentos = await withTenant(TENANT_A, (tx) => tx.appointment.count());
    expect(atendimentos).toBe(0);
  });
});

describe('Outbox — leitura cross-tenant pelo relay', () => {
  it('enxerga pendentes de tenants diferentes, mesmo com RLS ligada', async () => {
    const eventoA = appointmentDone(TENANT_A);
    const eventoB = appointmentDone(TENANT_B);

    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, eventoA));
    await withTenant(TENANT_B, (tx) => enqueueOutboxEvent(tx, TENANT_B, eventoB));

    const chaves = (await fetchPendingOutbox(50)).map((p) => p.event.idempotencyKey);

    expect(chaves).toContain(eventoA.idempotencyKey);
    expect(chaves).toContain(eventoB.idempotencyKey);
  });

  it('a RLS continua valendo pro caminho normal: um tenant não lê o outbox do outro', async () => {
    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, appointmentDone(TENANT_A)));

    const doB = await withTenant(TENANT_B, (tx) => tx.outboxEvent.count());

    expect(doB).toBe(0);
  });

  it('não devolve o que já foi publicado', async () => {
    const event = appointmentDone(TENANT_A);
    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, event));

    const antes = await fetchPendingOutbox(50);
    const linha = antes.find((p) => p.event.idempotencyKey === event.idempotencyKey);
    expect(linha).toBeDefined();

    await markOutboxPublished(TENANT_A, linha!.id);

    const depois = await fetchPendingOutbox(50);
    expect(depois.map((p) => p.event.idempotencyKey)).not.toContain(event.idempotencyKey);
  });

  it('marcar falha mantém a linha pendente e conta a tentativa', async () => {
    const event = appointmentDone(TENANT_A);
    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, event));
    const linha = (await fetchPendingOutbox(50)).find(
      (p) => p.event.idempotencyKey === event.idempotencyKey,
    )!;

    await markOutboxFailed(TENANT_A, linha.id, 'Redis fora do ar');

    const depois = (await fetchPendingOutbox(50)).find((p) => p.id === linha.id);
    expect(depois).toBeDefined();
    expect(depois!.attempts).toBe(1);
  });
});

describe('Outbox — ciclo do relay ponta a ponta', () => {
  it('publica no broker de verdade e marca a linha como publicada', async () => {
    await novoAtendimento(TENANT_A);
    const event = appointmentDone(TENANT_A);
    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, event));

    const result = await drainOutboxOnce({
      fetchPending: fetchPendingOutbox,
      publish: publishDomainEvent,
      markPublished: markOutboxPublished,
      markFailed: markOutboxFailed,
    });

    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const aindaPendente = (await fetchPendingOutbox(50)).map((p) => p.event.idempotencyKey);
    expect(aindaPendente).not.toContain(event.idempotencyKey);
  });

  it('broker fora do ar: a linha continua pendente para o próximo ciclo', async () => {
    const event = appointmentDone(TENANT_A);
    await withTenant(TENANT_A, (tx) => enqueueOutboxEvent(tx, TENANT_A, event));

    const result = await drainOutboxOnce({
      fetchPending: fetchPendingOutbox,
      publish: () => Promise.reject(new Error('ECONNREFUSED')),
      markPublished: markOutboxPublished,
      markFailed: markOutboxFailed,
    });

    expect(result.failed).toBeGreaterThanOrEqual(1);

    const pendentes = (await fetchPendingOutbox(50)).map((p) => p.event.idempotencyKey);
    expect(pendentes).toContain(event.idempotencyKey);
  });
});
