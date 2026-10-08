/**
 * Integração do VaccinationService/Repository contra Postgres de verdade.
 *
 * O que só um teste assim prova:
 *  - que registrar grava a aplicação, os animais e o `vaccination.applied`
 *    no outbox na MESMA transação;
 *  - que o RLS isola vacinações entre tenants;
 *  - que a função SECURITY DEFINER do lembrete enxerga todos os tenants e
 *    tira o animal re-vacinado com a mesma vacina;
 *  - que o mapeamento Decimal/Date do Prisma pro domínio está certo.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { VaccinationRepository } from '../src/repositories/vaccination.repository';
import { VaccinationService } from '../src/services/vaccination.service';
import { deriveEventIdempotencyKey } from '../src/services/billing';
import type {
  CreateClinicVaccinationInput,
  CreateExternalVaccinationInput,
} from '../src/schemas/vaccination.schema';

const TENANT_A = '99999999-9999-9999-9999-999999999999';
const TENANT_B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}

const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const repo = new VaccinationRepository();
// Relógio fixo: as datas de aplicação abaixo não podem cair "no futuro".
const service = new VaccinationService(repo, () => new Date('2026-10-08T12:00:00.000Z'));

const INFLUENZA = randomUUID();
const TETANO = randomUUID();

function novoInput(overrides: Partial<CreateClinicVaccinationInput> = {}): CreateClinicVaccinationInput {
  return {
    origin: 'clinic',
    ownerId: randomUUID(),
    propertyId: randomUUID(),
    veterinarianId: randomUUID(),
    productId: INFLUENZA,
    vaccineName: 'Influenza Equina',
    vaccineBatch: 'L123',
    pricePerDoseCents: 4500,
    doseIntervalDays: 180,
    animalIds: [randomUUID(), randomUUID()],
    appliedAt: '2026-04-08T12:00:00.000Z',
    laborCents: 5000,
    displacementKm: 20,
    displacementRateCents: 200,
    ...overrides,
  };
}

/** Vacina aplicada por outra pessoa — mesmo dia e intervalo da aplicação padrão acima. */
function novoExterno(overrides: Partial<CreateExternalVaccinationInput> = {}): CreateExternalVaccinationInput {
  return {
    origin: 'external',
    ownerId: randomUUID(),
    propertyId: randomUUID(),
    veterinarianId: randomUUID(),
    vaccineName: 'Influenza Equina',
    appliedBy: 'Dr. Fulano',
    doseIntervalDays: 180,
    animalIds: [randomUUID()],
    appliedAt: '2026-04-08T12:00:00.000Z',
    ...overrides,
  };
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
      await tx.vaccinationAnimal.deleteMany({});
      await tx.vaccination.deleteMany({});
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('VaccinationService.create — atomicidade (ADR-002)', () => {
  it('grava aplicação, animais e vaccination.applied juntos, e mapeia de volta pro domínio', async () => {
    const criada = await service.create(ctxA, novoInput({ dosesPerAnimal: 1.5 }));

    expect(criada.animalIds).toHaveLength(2);
    // Decimal do Prisma vira number no domínio
    expect(criada.dosesPerAnimal).toBe(1.5);
    expect(criada.displacementKm).toBe(20);
    // 3 doses × R$ 45 + R$ 50 + 20 km × R$ 2
    expect(criada.totalCents).toBe(13500 + 5000 + 4000);
    expect(criada.nextDoseAt).toBe('2026-10-05T12:00:00.000Z');

    const eventos = await withTenant(TENANT_A, (tx) => tx.outboxEvent.findMany({}));
    expect(eventos.map((e) => e.eventName)).toEqual(['vaccination.applied']);
    expect(eventos[0]!.idempotencyKey).toBe(deriveEventIdempotencyKey('vaccination.applied', criada.id));
    const envelope = eventos[0]!.payload as unknown as { payload: { totalDoses: number; totalCostCents: number } };
    expect(envelope.payload).toMatchObject({ totalDoses: 3, totalCostCents: criada.totalCents });
  });
});

describe('registro externo (aplicada por outra pessoa)', () => {
  it('grava sem produto e sem custo, e NÃO publica nada no outbox', async () => {
    const externo = await service.create(ctxA, novoExterno());

    expect(externo).toMatchObject({ origin: 'external', productId: null, appliedBy: 'Dr. Fulano', totalCents: 0 });
    expect(externo.nextDoseAt).toBe('2026-10-05T12:00:00.000Z');
    expect(await eventosDe(TENANT_A)).toEqual([]);
  });

  it('excluir registro externo também não publica nada', async () => {
    const externo = await service.create(ctxA, novoExterno());
    await service.softDelete(ctxA, externo.id);
    expect(await eventosDe(TENANT_A)).toEqual([]);
  });

  it('o banco recusa aplicação da clínica sem produto e registro externo com custo (CHECK)', async () => {
    const insert = (data: Record<string, unknown>) =>
      withTenant(TENANT_A, (tx) =>
        tx.vaccination.create({
          data: {
            tenantId: TENANT_A,
            ownerId: randomUUID(),
            propertyId: randomUUID(),
            veterinarianId: randomUUID(),
            vaccineName: 'X',
            appliedAt: new Date(),
            pricePerDoseCents: 0,
            totalCents: 0,
            ...data,
          },
        }),
      );

    await expect(insert({ origin: 'clinic', productId: null })).rejects.toThrow();
    await expect(insert({ origin: 'external', totalCents: 100 })).rejects.toThrow();
  });
});

describe('VaccinationService.softDelete', () => {
  it('com custo: exclui e publica vaccination.deleted junto', async () => {
    const criada = await service.create(ctxA, novoInput());

    await service.softDelete(ctxA, criada.id);

    expect(await service.findById(ctxA, criada.id)).toBeNull();
    expect(await eventosDe(TENANT_A)).toEqual(['vaccination.applied', 'vaccination.deleted']);
  });

  it('excluir duas vezes é 404 e não gera segundo evento', async () => {
    const criada = await service.create(ctxA, novoInput());
    await service.softDelete(ctxA, criada.id);

    await expect(service.softDelete(ctxA, criada.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await eventosDe(TENANT_A)).toEqual(['vaccination.applied', 'vaccination.deleted']);
  });
});

describe('RLS e consultas', () => {
  it('outro tenant não vê a vacinação', async () => {
    const criada = await service.create(ctxA, novoInput());
    expect(await service.findById(ctxB, criada.id)).toBeNull();
    expect((await service.list(ctxB, { page: 1, limit: 20 })).data).toEqual([]);
  });

  it('histórico do animal (RF-VAC-004): só as aplicações dele, mais recente primeiro', async () => {
    const cavalo = randomUUID();
    const antiga = await service.create(ctxA, novoInput({ animalIds: [cavalo], appliedAt: '2026-01-10T12:00:00.000Z' }));
    const nova = await service.create(ctxA, novoInput({ animalIds: [cavalo, randomUUID()] }));
    await service.create(ctxA, novoInput());

    const historico = await service.listByAnimal(ctxA, cavalo, { page: 1, limit: 20 });

    expect(historico.data.map((v) => v.id)).toEqual([nova.id, antiga.id]);
  });

  it('próxima dose: a aplicação mais recente de cada vacina', async () => {
    const cavalo = randomUUID();
    await service.create(ctxA, novoInput({ animalIds: [cavalo], appliedAt: '2026-01-10T12:00:00.000Z' }));
    const reforco = await service.create(ctxA, novoInput({ animalIds: [cavalo] }));
    await service.create(
      ctxA,
      novoInput({ animalIds: [cavalo], productId: TETANO, vaccineName: 'Tétano', doseIntervalDays: 365 }),
    );

    const boosters = await service.listBoostersByAnimal(ctxA, cavalo);

    expect(boosters.map((b) => b.vaccineName)).toEqual(['Influenza Equina', 'Tétano']);
    // O reforço substitui a aplicação de janeiro — a próxima dose vem dele.
    expect(boosters[0]).toMatchObject({ lastVaccinationId: reforco.id, nextDoseAt: reforco.nextDoseAt });
  });
});

describe('clinical_list_vaccinations_due (lembrete de re-vacinação)', () => {
  // Aplicações de 08/04 com intervalo de 180 dias → próxima dose 05/10.
  const JANELA: [Date, Date] = [new Date('2026-10-04T00:00:00.000Z'), new Date('2026-10-07T00:00:00.000Z')];

  it('enxerga vários tenants, uma linha por animal, e ignora aplicação excluída', async () => {
    const a = await service.create(ctxA, novoInput());
    const b = await service.create(ctxB, novoInput({ animalIds: [randomUUID()] }));
    const excluida = await service.create(ctxA, novoInput());
    await service.softDelete(ctxA, excluida.id);

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === a.id).map((r) => r.animalId).sort()).toEqual([...a.animalIds].sort());
    expect(due.find((r) => r.id === b.id)?.tenantId).toBe(TENANT_B);
    expect(due.some((r) => r.id === excluida.id)).toBe(false);
    expect(due[0]?.nextDoseAt.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('animal re-vacinado com a MESMA vacina sai do lembrete; os outros da aplicação ficam', async () => {
    const [cavalo, egua] = [randomUUID(), randomUUID()];
    const original = await service.create(ctxA, novoInput({ animalIds: [cavalo, egua] }));
    await service.create(ctxA, novoInput({ animalIds: [cavalo], appliedAt: '2026-09-01T12:00:00.000Z' }));

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === original.id).map((r) => r.animalId)).toEqual([egua]);
  });

  it('vacina DIFERENTE não conta como re-vacinação', async () => {
    const cavalo = randomUUID();
    const original = await service.create(ctxA, novoInput({ animalIds: [cavalo] }));
    await service.create(
      ctxA,
      novoInput({ animalIds: [cavalo], productId: TETANO, appliedAt: '2026-09-01T12:00:00.000Z' }),
    );

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === original.id).map((r) => r.animalId)).toEqual([cavalo]);
  });

  it('registro externo entra no lembrete como qualquer aplicação', async () => {
    const externo = await service.create(ctxA, novoExterno());

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === externo.id).map((r) => r.animalId)).toEqual(externo.animalIds);
  });

  it('aplicação da clínica substitui o registro externo digitado da mesma vacina (pelo nome)', async () => {
    const cavalo = randomUUID();
    const externo = await service.create(ctxA, novoExterno({ animalIds: [cavalo], vaccineName: ' influenza EQUINA' }));
    await service.create(ctxA, novoInput({ animalIds: [cavalo], appliedAt: '2026-09-01T12:00:00.000Z' }));

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.some((r) => r.id === externo.id)).toBe(false);
  });

  it('registro externo de OUTRA vacina digitada não substitui nada', async () => {
    const cavalo = randomUUID();
    const original = await service.create(ctxA, novoInput({ animalIds: [cavalo] }));
    await service.create(
      ctxA,
      novoExterno({ animalIds: [cavalo], vaccineName: 'Raiva', appliedAt: '2026-09-01T12:00:00.000Z' }),
    );

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === original.id).map((r) => r.animalId)).toEqual([cavalo]);
  });

  it('re-vacinação excluída não tira o animal do lembrete', async () => {
    const cavalo = randomUUID();
    const original = await service.create(ctxA, novoInput({ animalIds: [cavalo] }));
    const reforco = await service.create(ctxA, novoInput({ animalIds: [cavalo], appliedAt: '2026-09-01T12:00:00.000Z' }));
    await service.softDelete(ctxA, reforco.id);

    const due = await repo.listDueAcrossTenants(...JANELA);

    expect(due.filter((r) => r.id === original.id).map((r) => r.animalId)).toEqual([cavalo]);
  });
});
