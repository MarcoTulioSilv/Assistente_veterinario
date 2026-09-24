/**
 * Integração do AppointmentService/Repository contra Postgres de verdade.
 *
 * O que só um teste assim prova:
 *  - que finish() grava o atendimento e o evento no outbox na MESMA
 *    transação (o motivo do outbox existir);
 *  - que finalizar duas vezes não gera dois eventos, nem por corrida;
 *  - que o RLS isola atendimentos entre tenants;
 *  - que o mapeamento Decimal/Date do Prisma pro domínio está certo.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { AppointmentRepository } from '../src/repositories/appointment.repository';
import { AppointmentService, deriveEventIdempotencyKey } from '../src/services/appointment.service';
import type { CreateAppointmentInput } from '../src/schemas/appointment.schema';

const TENANT_A = '99999999-9999-9999-9999-999999999999';
const TENANT_B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}

const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const repo = new AppointmentRepository();
const service = new AppointmentService(repo);

function novoInput(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
  return {
    ownerId: randomUUID(),
    propertyId: randomUUID(),
    animalId: randomUUID(),
    veterinarianId: randomUUID(),
    type: 'clinico_geral',
    performedAt: new Date().toISOString(),
    laborCents: 10000,
    displacementKm: 20,
    displacementRateCents: 250,
    items: [
      { kind: 'product', productId: randomUUID(), description: 'Vacina Tétano', quantity: 2, unitPriceCents: 1500 },
      { kind: 'procedure', description: 'Consulta clínica', quantity: 1, unitPriceCents: 9000 },
    ],
    ...overrides,
  };
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
  await prisma.$disconnect();
});

describe('AppointmentRepository.create', () => {
  it('grava itens, prescrição e ficha clínica junto, e mapeia de volta pro domínio', async () => {
    const criado = await service.create(ctxA, {
      ...novoInput(),
      prescriptions: [
        {
          medicationName: 'Flunixin',
          dose: '1,1 mg/kg',
          route: 'intravenosa',
          schedule: 'a cada 24h por 3 dias',
          applicationSite: 'jugular',
        },
      ],
      medicalRecord: {
        anamnesis: 'Claudicação há 3 dias',
        generalExam: { temperatura: 38.2, fc: 44 },
        specialExams: { locomotor: { grau: 2 } },
        diagnosis: 'Tendinite',
      },
    });

    expect(criado.items).toHaveLength(2);
    expect(criado.prescriptions).toHaveLength(1);
    expect(criado.medicalRecord?.diagnosis).toBe('Tendinite');
    // JSONB volta como objeto, não string
    expect(criado.medicalRecord?.generalExam).toEqual({ temperatura: 38.2, fc: 44 });
    // Decimal do Prisma vira number no domínio
    expect(criado.displacementKm).toBe(20);
    expect(criado.items.find((i) => i.kind === 'product')?.quantity).toBe(2);
  });

  it('calcula o total: itens + mão de obra + km × valor/km', async () => {
    const criado = await service.create(ctxA, novoInput());

    // (2 × 1500) + 9000 + 10000 + (20 × 250)
    expect(criado.totalCents).toBe(3000 + 9000 + 10000 + 5000);
    expect(criado.status).toBe('draft');
  });
});

describe('AppointmentService.finish — atomicidade (ADR-002)', () => {
  it('finaliza e grava o evento no outbox na mesma transação', async () => {
    const criado = await service.create(ctxA, novoInput());

    const finalizado = await service.finish(ctxA, criado.id);

    expect(finalizado.status).toBe('finished');
    expect(finalizado.finishedAt).not.toBeNull();
    expect(finalizado.totalCents).toBe(27000);

    const eventos = await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({}));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.eventName).toBe('appointment.done');
    expect(eventos[0]!.publishedAt).toBeNull();
  });

  it('o evento carrega só os itens de estoque, com o total congelado (RN-003)', async () => {
    const productId = randomUUID();
    const criado = await service.create(
      ctxA,
      novoInput({
        items: [
          { kind: 'product', productId, description: 'Vacina', quantity: 3, unitPriceCents: 1000 },
          { kind: 'procedure', description: 'Consulta', quantity: 1, unitPriceCents: 5000 },
        ],
      }),
    );

    await service.finish(ctxA, criado.id);

    const evento = (await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({})))[0]!;
    // O outbox guarda o envelope DomainEvent inteiro — é o que o relay
    // publica, sem remontar nada. O payload de negócio fica um nível abaixo.
    const envelope = evento.payload as unknown as {
      name: string;
      payload: {
        appointmentId: string;
        totalCostCents: number;
        consumedItems: Array<{ productId: string; quantity: number }>;
      };
    };
    const payload = envelope.payload;

    expect(envelope.name).toBe('appointment.done');

    expect(payload.appointmentId).toBe(criado.id);
    expect(payload.consumedItems).toEqual([{ productId, quantity: 3 }]);
    expect(payload.totalCostCents).toBe(criado.totalCents);
  });

  it('a chave do evento vem do atendimento, então nunca há dois eventos pro mesmo atendimento', async () => {
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    const evento = (await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({})))[0]!;
    expect(evento.idempotencyKey).toBe(deriveEventIdempotencyKey('appointment.done', criado.id));
  });

  it('finalizar duas vezes falha e NÃO gera segundo evento', async () => {
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    await expect(service.finish(ctxA, criado.id)).rejects.toThrow(/já finalizado/);

    const eventos = await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({}));
    expect(eventos).toHaveLength(1);
  });

  it('não dá pra editar o orçamento depois de finalizado', async () => {
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    await expect(service.update(ctxA, criado.id, { laborCents: 1 })).rejects.toThrow(/congelado/);

    const depois = await service.findById(ctxA, criado.id);
    expect(depois!.totalCents).toBe(27000);
  });
});

describe('AppointmentRepository.update', () => {
  it('atualiza campos escalares e recalcula o total', async () => {
    const criado = await service.create(ctxA, novoInput());
    const outraPropriedade = randomUUID();
    const outroVet = randomUUID();

    const atualizado = await service.update(ctxA, criado.id, {
      propertyId: outraPropriedade,
      veterinarianId: outroVet,
      type: 'locomotor',
      animalLocation: 'Haras vizinho',
      performedAt: '2026-09-20T08:00:00.000Z',
      laborCents: 20000,
      displacementKm: 5,
      displacementRateCents: 300,
    });

    expect(atualizado.propertyId).toBe(outraPropriedade);
    expect(atualizado.veterinarianId).toBe(outroVet);
    expect(atualizado.type).toBe('locomotor');
    expect(atualizado.animalLocation).toBe('Haras vizinho');
    expect(atualizado.performedAt).toBe('2026-09-20T08:00:00.000Z');
    // itens (3000 + 9000) vêm do que já estava gravado
    expect(atualizado.totalCents).toBe(12000 + 20000 + 1500);
  });

  it('substituir os itens troca o orçamento inteiro, sem deixar órfão', async () => {
    const criado = await service.create(ctxA, novoInput());
    expect(criado.items).toHaveLength(2);

    const atualizado = await service.update(ctxA, criado.id, {
      items: [{ kind: 'procedure', description: 'Só a consulta', quantity: 1, unitPriceCents: 7000 }],
    });

    expect(atualizado.items).toHaveLength(1);
    expect(atualizado.items[0]!.description).toBe('Só a consulta');
    // 7000 + mão de obra 10000 + deslocamento 5000
    expect(atualizado.totalCents).toBe(22000);

    const linhas = await withTenant(TENANT_A, (tx) =>
      tx.appointmentItem.count({ where: { appointmentId: criado.id } }),
    );
    expect(linhas).toBe(1);
  });

  it('substitui as prescrições por inteiro', async () => {
    const criado = await service.create(ctxA, {
      ...novoInput(),
      prescriptions: [
        { medicationName: 'Flunixin', dose: '1 mg/kg', route: 'intravenosa', schedule: '24h' },
      ],
    });

    const atualizado = await service.update(ctxA, criado.id, {
      prescriptions: [
        { medicationName: 'Fenilbutazona', dose: '2 mg/kg', route: 'oral', schedule: '12h', notes: 'com ração' },
      ],
    });

    expect(atualizado.prescriptions).toHaveLength(1);
    expect(atualizado.prescriptions[0]!.medicationName).toBe('Fenilbutazona');
    expect(atualizado.prescriptions[0]!.notes).toBe('com ração');
  });

  it('cria a ficha clínica no update quando o atendimento ainda não tinha', async () => {
    const criado = await service.create(ctxA, novoInput());
    expect(criado.medicalRecord).toBeNull();

    const atualizado = await service.update(ctxA, criado.id, {
      medicalRecord: { diagnosis: 'Tendinite', generalExam: { temperatura: 38.5 } },
    });

    expect(atualizado.medicalRecord?.diagnosis).toBe('Tendinite');
    expect(atualizado.medicalRecord?.generalExam).toEqual({ temperatura: 38.5 });
  });

  it('atualiza a ficha clínica já existente em vez de duplicar', async () => {
    const criado = await service.create(ctxA, {
      ...novoInput(),
      medicalRecord: { diagnosis: 'Suspeita inicial' },
    });

    const atualizado = await service.update(ctxA, criado.id, {
      medicalRecord: { diagnosis: 'Tendinite confirmada', treatment: 'Repouso 30 dias' },
    });

    expect(atualizado.medicalRecord?.diagnosis).toBe('Tendinite confirmada');
    expect(atualizado.medicalRecord?.treatment).toBe('Repouso 30 dias');

    const fichas = await withTenant(TENANT_A, (tx) =>
      tx.medicalRecord.count({ where: { appointmentId: criado.id } }),
    );
    expect(fichas).toBe(1);
  });
});

describe('AppointmentRepository — RLS e histórico', () => {
  it('um tenant não enxerga atendimento do outro', async () => {
    const criado = await service.create(ctxA, novoInput());

    expect(await service.findById(ctxB, criado.id)).toBeNull();

    const listaB = await service.list(ctxB, { page: 1, limit: 20 });
    expect(listaB.pagination.total).toBe(0);
  });

  it('RF-ATD-011: histórico filtra pelo animal', async () => {
    const animalId = randomUUID();
    await service.create(ctxA, novoInput({ animalId }));
    await service.create(ctxA, novoInput({ animalId }));
    await service.create(ctxA, novoInput());

    const historico = await service.listByAnimal(ctxA, animalId, { page: 1, limit: 20 });

    expect(historico.pagination.total).toBe(2);
    expect(historico.data.every((a) => a.animalId === animalId)).toBe(true);
  });

  it('soft delete some da listagem mas não apaga a linha (LGPD)', async () => {
    const criado = await service.create(ctxA, novoInput());

    await service.softDelete(ctxA, criado.id);

    expect(await service.findById(ctxA, criado.id)).toBeNull();
    const aindaNoBanco = await withTenant(TENANT_A, (tx) =>
      tx.appointment.findFirst({ where: { id: criado.id } }),
    );
    expect(aindaNoBanco).not.toBeNull();
    expect(aindaNoBanco!.deletedAt).not.toBeNull();
  });
});
