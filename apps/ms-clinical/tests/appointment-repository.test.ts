/**
 * Integração do AppointmentService/Repository contra Postgres de verdade.
 *
 * O que só um teste assim prova:
 *  - que finish() grava o atendimento e o evento no outbox na MESMA
 *    transação (o motivo do outbox existir);
 *  - que finalizar duas vezes não gera dois eventos, nem por corrida;
 *  - que a ficha e a receita são POR ANIMAL e a FK composta segura isso
 *    (reunião de 20/10/2026: vários animais por orçamento);
 *  - que o RLS isola atendimentos entre tenants;
 *  - que o mapeamento Decimal/Date do Prisma pro domínio está certo.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { AppointmentRepository } from '../src/repositories/appointment.repository';
import { AppointmentService } from '../src/services/appointment.service';
import { deriveEventIdempotencyKey } from '../src/services/billing';
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

/**
 * Orçamento padrão dos testes: 2 × R$ 15 de produto + mão de obra R$ 190
 * (consulta R$ 90 + serviço R$ 100) + 20 km × R$ 2,50 = R$ 270.
 */
function novoInput(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
  return {
    ownerId: randomUUID(),
    propertyId: randomUUID(),
    veterinarianId: randomUUID(),
    type: 'clinico_geral',
    animalIds: [randomUUID()],
    performedAt: new Date().toISOString(),
    procedureDescription: 'Consulta clínica e aplicação de vacina',
    laborCents: 19000,
    displacementKm: 20,
    displacementRateCents: 250,
    items: [{ productId: randomUUID(), description: 'Vacina Tétano', quantity: 2, unitPriceCents: 1500 }],
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
  it('vários animais, cada um com a sua ficha e receita — e mapeia de volta pro domínio', async () => {
    const [relampago, estrela] = [randomUUID(), randomUUID()];

    const criado = await service.create(ctxA, {
      ...novoInput({ animalIds: [relampago, estrela, relampago] }),
      locationLatitude: -17.881512,
      locationLongitude: -51.714133,
      clinical: [
        {
          animalId: relampago,
          medicalRecord: {
            anamnesis: 'Claudicação há 3 dias',
            generalExam: { temperatura: 38.2, fc: 44 },
            diagnosis: 'Tendinite',
          },
          prescriptions: [
            { medicationName: 'Flunixin', dose: '1,1 mg/kg', route: 'intravenosa', schedule: 'a cada 24h por 3 dias' },
          ],
        },
        { animalId: estrela, medicalRecord: { diagnosis: 'Hígida' } },
      ],
    });

    // Repetido é ignorado.
    expect(criado.animals.map((a) => a.animalId).sort()).toEqual([relampago, estrela].sort());
    const deRelampago = criado.animals.find((a) => a.animalId === relampago)!;
    const deEstrela = criado.animals.find((a) => a.animalId === estrela)!;
    expect(deRelampago.medicalRecord?.diagnosis).toBe('Tendinite');
    // JSONB volta como objeto, não string
    expect(deRelampago.medicalRecord?.generalExam).toEqual({ temperatura: 38.2, fc: 44 });
    expect(deRelampago.prescriptions).toHaveLength(1);
    expect(deEstrela.medicalRecord?.diagnosis).toBe('Hígida');
    expect(deEstrela.prescriptions).toEqual([]);
    // Decimal do Prisma vira number no domínio
    expect(criado.displacementKm).toBe(20);
    expect(criado.items[0]!.quantity).toBe(2);
    expect(criado.locationLatitude).toBe(-17.881512);
    expect(criado.locationLongitude).toBe(-51.714133);
    expect(criado.procedureDescription).toBe('Consulta clínica e aplicação de vacina');
  });

  it('calcula o total: itens + mão de obra + km × valor/km', async () => {
    const criado = await service.create(ctxA, novoInput());

    // (2 × 1500) + 19000 + (20 × 250)
    expect(criado.totalCents).toBe(3000 + 19000 + 5000);
    expect(criado.status).toBe('draft');
  });

  it('sem nome informado, usa data (dia de São Paulo) + especialidade', async () => {
    // 01h UTC do dia 21 ainda é dia 20 em São Paulo.
    const criado = await service.create(
      ctxA,
      novoInput({ performedAt: '2026-10-21T01:00:00.000Z', type: 'locomotor' }),
    );
    expect(criado.title).toBe('20/10/2026 - Locomotor');

    const nomeado = await service.create(ctxA, novoInput({ title: '20/10 Locomotor Fazenda Boa Vista' }));
    expect(nomeado.title).toBe('20/10 Locomotor Fazenda Boa Vista');
  });

  it('ficha de animal que não está no orçamento é recusada', async () => {
    await expect(
      service.create(ctxA, novoInput({ clinical: [{ animalId: randomUUID(), medicalRecord: { diagnosis: 'x' } }] })),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('o banco também recusa ponto no mapa pela metade (CHECK)', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.appointment.create({
          data: {
            tenantId: TENANT_A,
            ownerId: randomUUID(),
            propertyId: randomUUID(),
            veterinarianId: randomUUID(),
            title: 'x',
            type: 'clinico_geral',
            performedAt: new Date(),
            locationLatitude: -17.88,
          },
        }),
      ),
    ).rejects.toThrow();
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

  it('o evento carrega os produtos consumidos, com o total congelado (RN-003)', async () => {
    const productId = randomUUID();
    const criado = await service.create(
      ctxA,
      novoInput({ items: [{ productId, description: 'Vacina', quantity: 3, unitPriceCents: 1000 }] }),
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

    expect(envelope.name).toBe('appointment.done');
    expect(envelope.payload.appointmentId).toBe(criado.id);
    expect(envelope.payload.consumedItems).toEqual([{ productId, quantity: 3 }]);
    expect(envelope.payload.totalCostCents).toBe(criado.totalCents);
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

  it('finalizado entre a leitura e a gravação: o repositório recusa a edição', async () => {
    // Simula a corrida que o service sozinho não pega: ele leu 'draft', mas
    // outra requisição finalizou antes da gravação.
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    await expect(repo.update(ctxA, criado.id, { laborCents: 1, totalCents: 1 })).rejects.toThrow(/congelado/);

    expect((await service.findById(ctxA, criado.id))!.totalCents).toBe(27000);
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
      title: 'Revisão Locomotor',
      animalLocation: 'Haras vizinho',
      locationLatitude: -17.9,
      locationLongitude: -51.7,
      performedAt: '2026-09-20T08:00:00.000Z',
      procedureDescription: 'Exame de claudicação',
      laborCents: 20000,
      displacementKm: 5,
      displacementRateCents: 300,
    });

    expect(atualizado).toMatchObject({
      propertyId: outraPropriedade,
      veterinarianId: outroVet,
      type: 'locomotor',
      title: 'Revisão Locomotor',
      animalLocation: 'Haras vizinho',
      locationLatitude: -17.9,
      locationLongitude: -51.7,
      performedAt: '2026-09-20T08:00:00.000Z',
      procedureDescription: 'Exame de claudicação',
    });
    // itens (3000) vêm do que já estava gravado
    expect(atualizado.totalCents).toBe(3000 + 20000 + 1500);
  });

  it('null apaga o ponto no mapa e a descrição', async () => {
    const criado = await service.create(
      ctxA,
      novoInput({ locationLatitude: -17.88, locationLongitude: -51.71 }),
    );

    const atualizado = await service.update(ctxA, criado.id, {
      locationLatitude: null,
      locationLongitude: null,
      procedureDescription: null,
    });

    expect(atualizado.locationLatitude).toBeNull();
    expect(atualizado.locationLongitude).toBeNull();
    expect(atualizado.procedureDescription).toBeNull();
  });

  it('substituir os itens troca o orçamento inteiro, sem deixar órfão', async () => {
    const criado = await service.create(ctxA, novoInput());
    expect(criado.items).toHaveLength(1);

    const atualizado = await service.update(ctxA, criado.id, {
      items: [{ productId: randomUUID(), description: 'Seringa', quantity: 2, unitPriceCents: 300 }],
    });

    expect(atualizado.items).toHaveLength(1);
    expect(atualizado.items[0]!.description).toBe('Seringa');
    // 600 + mão de obra 19000 + deslocamento 5000
    expect(atualizado.totalCents).toBe(24600);

    const linhas = await withTenant(TENANT_A, (tx) =>
      tx.appointmentItem.count({ where: { appointmentId: criado.id } }),
    );
    expect(linhas).toBe(1);
  });

  it('trocar os animais: quem sai leva a ficha e a receita; quem fica mantém as suas', async () => {
    const [fica, sai, entra] = [randomUUID(), randomUUID(), randomUUID()];
    const criado = await service.create(ctxA, {
      ...novoInput({ animalIds: [fica, sai] }),
      clinical: [
        { animalId: fica, medicalRecord: { diagnosis: 'Fica' } },
        {
          animalId: sai,
          medicalRecord: { diagnosis: 'Sai' },
          prescriptions: [{ medicationName: 'X', dose: '1', route: 'oral', schedule: 'dose única' }],
        },
      ],
    });

    const atualizado = await service.update(ctxA, criado.id, { animalIds: [fica, entra] });

    expect(atualizado.animals.map((a) => a.animalId).sort()).toEqual([fica, entra].sort());
    expect(atualizado.animals.find((a) => a.animalId === fica)!.medicalRecord?.diagnosis).toBe('Fica');
    expect(atualizado.animals.find((a) => a.animalId === entra)!.medicalRecord).toBeNull();

    const [fichas, receitas] = await withTenant(TENANT_A, (tx) =>
      Promise.all([
        tx.medicalRecord.count({ where: { appointmentId: criado.id, animalId: sai } }),
        tx.prescription.count({ where: { appointmentId: criado.id, animalId: sai } }),
      ]),
    );
    expect([fichas, receitas]).toEqual([0, 0]);
  });

  it('cria a ficha do animal no update quando ainda não tinha, e atualiza sem duplicar', async () => {
    const animalId = randomUUID();
    const criado = await service.create(ctxA, novoInput({ animalIds: [animalId] }));
    expect(criado.animals[0]!.medicalRecord).toBeNull();

    await service.update(ctxA, criado.id, {
      clinical: [{ animalId, medicalRecord: { diagnosis: 'Suspeita', generalExam: { temperatura: 38.5 } } }],
    });
    const atualizado = await service.update(ctxA, criado.id, {
      clinical: [{ animalId, medicalRecord: { diagnosis: 'Tendinite confirmada', treatment: 'Repouso 30 dias' } }],
    });

    const ficha = atualizado.animals[0]!.medicalRecord!;
    expect(ficha.diagnosis).toBe('Tendinite confirmada');
    expect(ficha.treatment).toBe('Repouso 30 dias');
    // Exame não veio no segundo update — o que estava gravado fica.
    expect(ficha.generalExam).toEqual({ temperatura: 38.5 });

    const fichas = await withTenant(TENANT_A, (tx) =>
      tx.medicalRecord.count({ where: { appointmentId: criado.id } }),
    );
    expect(fichas).toBe(1);
  });

  it('substitui a receita do animal por inteiro, sem mexer na dos outros', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const receita = (medicationName: string) => [{ medicationName, dose: '1', route: 'oral' as const, schedule: '12h' }];
    const criado = await service.create(ctxA, {
      ...novoInput({ animalIds: [a, b] }),
      clinical: [
        { animalId: a, prescriptions: receita('Flunixin') },
        { animalId: b, prescriptions: receita('Penicilina') },
      ],
    });

    const atualizado = await service.update(ctxA, criado.id, {
      clinical: [{ animalId: a, prescriptions: [{ ...receita('Fenilbutazona')[0]!, notes: 'com ração' }] }],
    });

    const deA = atualizado.animals.find((x) => x.animalId === a)!;
    const deB = atualizado.animals.find((x) => x.animalId === b)!;
    expect(deA.prescriptions.map((p) => [p.medicationName, p.notes])).toEqual([['Fenilbutazona', 'com ração']]);
    expect(deB.prescriptions.map((p) => p.medicationName)).toEqual(['Penicilina']);
  });

  it('ficha de animal que não está no orçamento é recusada no update', async () => {
    const criado = await service.create(ctxA, novoInput());

    await expect(
      service.update(ctxA, criado.id, { clinical: [{ animalId: randomUUID(), medicalRecord: { diagnosis: 'x' } }] }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('AppointmentRepository — RLS, histórico e filtros', () => {
  it('um tenant não enxerga atendimento do outro', async () => {
    const criado = await service.create(ctxA, novoInput());

    expect(await service.findById(ctxB, criado.id)).toBeNull();

    const listaB = await service.list(ctxB, { page: 1, limit: 20 });
    expect(listaB.pagination.total).toBe(0);
  });

  it('RF-ATD-011: histórico do animal traz os orçamentos em que ele está, inclusive com outros animais', async () => {
    const animalId = randomUUID();
    await service.create(ctxA, novoInput({ animalIds: [animalId] }));
    await service.create(ctxA, novoInput({ animalIds: [randomUUID(), animalId] }));
    await service.create(ctxA, novoInput());

    const historico = await service.listByAnimal(ctxA, animalId, { page: 1, limit: 20 });

    expect(historico.pagination.total).toBe(2);
    expect(historico.data.every((a) => a.animals.some((x) => x.animalId === animalId))).toBe(true);
  });

  it('filtra em aberto (rascunho) e finalizados — na lista e no histórico do animal', async () => {
    const animalId = randomUUID();
    const aberto = await service.create(ctxA, novoInput({ animalIds: [animalId] }));
    const finalizado = await service.create(ctxA, novoInput({ animalIds: [animalId] }));
    await service.finish(ctxA, finalizado.id);

    const abertos = await service.list(ctxA, { page: 1, limit: 20, status: 'draft' });
    const finalizados = await service.listByAnimal(ctxA, animalId, { page: 1, limit: 20, status: 'finished' });

    expect(abertos.data.map((a) => a.id)).toEqual([aberto.id]);
    expect(finalizados.data.map((a) => a.id)).toEqual([finalizado.id]);
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

describe('Exclusão de atendimento finalizado — cancela a pendência', () => {
  it('rascunho excluído não deixa evento nenhum no outbox', async () => {
    const criado = await service.create(ctxA, novoInput());

    await service.softDelete(ctxA, criado.id);

    const eventos = await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({}));
    expect(eventos).toHaveLength(0);
  });

  it('finalizado excluído grava appointment.deleted no outbox, na mesma transação', async () => {
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    await service.softDelete(ctxA, criado.id);

    const eventos = await withTenant(TENANT_A, (tx) =>
      tx.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    expect(eventos.map((e) => e.eventName)).toEqual(['appointment.done', 'appointment.deleted']);

    const envelope = eventos[1]!.payload as unknown as {
      payload: { appointmentId: string; totalCostCents: number; performedAt: string };
    };
    expect(envelope.payload.appointmentId).toBe(criado.id);
    expect(envelope.payload.totalCostCents).toBe(27000);
    expect(envelope.payload.performedAt).toBe(criado.performedAt);
  });

  it('excluir duas vezes falha e não grava segundo evento', async () => {
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);
    await service.softDelete(ctxA, criado.id);

    await expect(service.softDelete(ctxA, criado.id)).rejects.toThrow(/não encontrado/);

    const exclusoes = await withTenant(TENANT_A, (tx) =>
      tx.outboxEvent.count({ where: { eventName: 'appointment.deleted' } }),
    );
    expect(exclusoes).toBe(1);
  });

  it('status mudou entre a leitura e a exclusão: falha em vez de excluir sem avisar o MS6', async () => {
    // Simula a corrida: o service leu 'draft', mas outra requisição finalizou
    // antes da exclusão. Sem o UPDATE condicionado, o atendimento sumiria SEM
    // appointment.deleted e a pendência do finish ficaria órfã.
    const criado = await service.create(ctxA, novoInput());
    await service.finish(ctxA, criado.id);

    await expect(repo.softDelete(ctxA, criado.id, 'draft', null)).rejects.toThrow(/mudou de estado/);

    expect(await service.findById(ctxA, criado.id)).not.toBeNull();
  });
});
