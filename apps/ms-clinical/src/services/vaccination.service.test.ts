import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, Vaccination, DomainEvent, VaccinationAppliedPayload } from '@quironequine/shared-types';
import type { VaccinationRepository, CreateVaccinationData } from '../repositories/vaccination.repository';
import {
  VaccinationService,
  calculateVaccinationTotalCents,
  calculateNextDoseAt,
  boosterStatus,
  toBoosters,
  sameVaccine,
  buildVaccinationAppliedEvent,
} from './vaccination.service';
import { deriveEventIdempotencyKey } from './billing';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 'trace-teste',
};

const VACCINATION_ID = '33333333-3333-3333-3333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_PRODUCT_ID = '55555555-5555-5555-5555-555555555555';
const ANIMAL_A = '66666666-6666-6666-6666-666666666666';
const ANIMAL_B = '77777777-7777-7777-7777-777777777777';

// 10h de São Paulo (UTC-3) de 08/10/2026.
const NOW = new Date('2026-10-08T13:00:00.000Z');

function vaccination(overrides: Partial<Vaccination> = {}): Vaccination {
  return {
    id: VACCINATION_ID,
    origin: 'clinic',
    ownerId: '88888888-8888-8888-8888-888888888888',
    propertyId: '99999999-9999-9999-9999-999999999999',
    veterinarianId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    productId: PRODUCT_ID,
    vaccineName: 'Influenza Equina',
    vaccineBatch: 'L123',
    appliedBy: null,
    animalIds: [ANIMAL_A, ANIMAL_B],
    dosesPerAnimal: 1,
    appliedAt: '2026-10-08T12:00:00.000Z',
    doseIntervalDays: 180,
    nextDoseAt: '2027-04-06T12:00:00.000Z',
    pricePerDoseCents: 4500,
    laborCents: 5000,
    displacementKm: 20,
    displacementRateCents: 200,
    totalCents: 18000,
    notes: null,
    createdAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

/** Vacina aplicada por outra pessoa, digitada (fora do catálogo). */
const EXTERNAL_INPUT = {
  origin: 'external' as const,
  ownerId: '88888888-8888-8888-8888-888888888888',
  propertyId: '99999999-9999-9999-9999-999999999999',
  veterinarianId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  vaccineName: 'Raiva',
  appliedBy: 'Dr. Fulano (CRMV-MG 1234)',
  doseIntervalDays: 365,
  animalIds: [ANIMAL_A],
  appliedAt: '2026-03-01T12:00:00.000Z',
};

const INPUT = {
  origin: 'clinic' as const,
  ownerId: '88888888-8888-8888-8888-888888888888',
  propertyId: '99999999-9999-9999-9999-999999999999',
  veterinarianId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  productId: PRODUCT_ID,
  vaccineName: 'Influenza Equina',
  pricePerDoseCents: 4500,
  doseIntervalDays: 180,
  animalIds: [ANIMAL_A, ANIMAL_B],
  appliedAt: '2026-10-08T12:00:00.000Z',
  laborCents: 5000,
  displacementKm: 20,
  displacementRateCents: 200,
};

/** O `create` falso devolve a vacinação gravada e guarda o evento montado pelo service. */
function setup(existing: Vaccination | null = vaccination()) {
  const captured: { data?: CreateVaccinationData; event?: DomainEvent<unknown> } = {};
  const repo = {
    list: vi.fn(),
    listByAnimal: vi.fn(),
    listAllByAnimal: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(existing),
    create: vi.fn(async (_ctx: RequestContext, data: CreateVaccinationData, build: (v: Vaccination) => DomainEvent<unknown>) => {
      captured.data = data;
      const created = vaccination({
        origin: data.origin,
        productId: data.productId,
        appliedBy: data.appliedBy,
        animalIds: data.animalIds,
        dosesPerAnimal: data.dosesPerAnimal,
        totalCents: data.totalCents,
        appliedAt: data.appliedAt.toISOString(),
        nextDoseAt: data.nextDoseAt ? data.nextDoseAt.toISOString() : null,
      });
      captured.event = build(created);
      return created;
    }),
    softDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as VaccinationRepository;
  return { service: new VaccinationService(repo, () => NOW), repo, captured };
}

describe('calculateVaccinationTotalCents (RF-VAC-003)', () => {
  it('vacina (preço por dose × doses) + mão de obra + km × valor/km', () => {
    // 2 doses × R$ 45 + R$ 50 + 20 km × R$ 2
    expect(
      calculateVaccinationTotalCents({
        pricePerDoseCents: 4500,
        doses: 2,
        laborCents: 5000,
        displacementKm: 20,
        displacementRateCents: 200,
      }),
    ).toBe(9000 + 5000 + 4000);
  });

  it('dose fracionada arredonda a vacina uma vez, no fim', () => {
    expect(
      calculateVaccinationTotalCents({
        pricePerDoseCents: 333,
        doses: 1.5,
        laborCents: 0,
        displacementKm: 0,
        displacementRateCents: 0,
      }),
    ).toBe(500);
  });
});

describe('calculateNextDoseAt (RF-VAC-005)', () => {
  it('aplicação + intervalo; sem intervalo, sem próxima dose', () => {
    const appliedAt = new Date('2026-10-08T12:00:00.000Z');
    expect(calculateNextDoseAt(appliedAt, 180)?.toISOString()).toBe('2027-04-06T12:00:00.000Z');
    expect(calculateNextDoseAt(appliedAt, null)).toBeNull();
  });
});

describe('boosterStatus', () => {
  it('atrasada, em breve (até 7 dias, incluindo hoje) ou agendada — pelo dia de São Paulo', () => {
    expect(boosterStatus(new Date('2026-10-07T12:00:00.000Z'), NOW)).toBe('overdue');
    expect(boosterStatus(new Date('2026-10-08T23:00:00.000Z'), NOW)).toBe('due_soon');
    expect(boosterStatus(new Date('2026-10-15T12:00:00.000Z'), NOW)).toBe('due_soon');
    expect(boosterStatus(new Date('2026-10-16T12:00:00.000Z'), NOW)).toBe('scheduled');
  });

  it('02h UTC do dia 09 ainda é dia 08 em São Paulo — não está atrasada', () => {
    expect(boosterStatus(new Date('2026-10-09T02:00:00.000Z'), new Date('2026-10-09T01:00:00.000Z'))).toBe(
      'due_soon',
    );
  });
});

describe('toBoosters', () => {
  it('só a aplicação mais recente de cada vacina conta — re-vacinar substitui a data', () => {
    const boosters = toBoosters(
      [
        vaccination({ id: 'nova', appliedAt: '2026-10-01T12:00:00.000Z', nextDoseAt: '2027-03-30T12:00:00.000Z' }),
        vaccination({ id: 'antiga', appliedAt: '2026-04-01T12:00:00.000Z', nextDoseAt: '2026-09-28T12:00:00.000Z' }),
      ],
      NOW,
    );

    expect(boosters).toEqual([
      expect.objectContaining({ lastVaccinationId: 'nova', nextDoseAt: '2027-03-30T12:00:00.000Z', status: 'scheduled' }),
    ]);
  });

  it('se a mais recente não tem intervalo, a vacina não tem próxima dose', () => {
    const boosters = toBoosters(
      [
        vaccination({ id: 'nova', doseIntervalDays: null, nextDoseAt: null }),
        vaccination({ id: 'antiga', nextDoseAt: '2026-09-28T12:00:00.000Z' }),
      ],
      NOW,
    );
    expect(boosters).toEqual([]);
  });

  it('uma entrada por vacina, da próxima dose mais próxima para a mais distante', () => {
    const boosters = toBoosters(
      [
        vaccination({ id: 'v1', productId: PRODUCT_ID, nextDoseAt: '2027-04-06T12:00:00.000Z' }),
        vaccination({ id: 'v2', productId: OTHER_PRODUCT_ID, vaccineName: 'Tétano', nextDoseAt: '2026-10-05T12:00:00.000Z' }),
      ],
      NOW,
    );
    expect(boosters.map((b) => [b.vaccineName, b.status])).toEqual([
      ['Tétano', 'overdue'],
      ['Influenza Equina', 'scheduled'],
    ]);
  });
});

describe('VaccinationService.create', () => {
  it('calcula total e próxima dose, tira animal repetido e publica vaccination.applied', async () => {
    const { service, captured } = setup();

    await service.create(ctx, { ...INPUT, animalIds: [ANIMAL_A, ANIMAL_A, ANIMAL_B] });

    expect(captured.data).toMatchObject({
      animalIds: [ANIMAL_A, ANIMAL_B],
      dosesPerAnimal: 1,
      totalCents: 18000,
      doseIntervalDays: 180,
      vaccineBatch: null,
    });
    expect(captured.data?.nextDoseAt?.toISOString()).toBe('2027-04-06T12:00:00.000Z');

    const event = captured.event as DomainEvent<VaccinationAppliedPayload>;
    expect(event.name).toBe('vaccination.applied');
    expect(event.payload).toMatchObject({ totalDoses: 2, totalCostCents: 18000, productId: PRODUCT_ID });
    expect(event.payload.performedAt).toBe(INPUT.appliedAt);
  });

  it('dose dupla: dobra as doses baixadas e o valor da vacina', async () => {
    const { service, captured } = setup();

    await service.create(ctx, { ...INPUT, dosesPerAnimal: 2 });

    expect(captured.data?.totalCents).toBe(4 * 4500 + 5000 + 4000);
    expect((captured.event as DomainEvent<VaccinationAppliedPayload>).payload.totalDoses).toBe(4);
  });

  it('vacina sem intervalo não tem próxima dose', async () => {
    const { service, captured } = setup();
    await service.create(ctx, { ...INPUT, doseIntervalDays: null });
    expect(captured.data?.nextDoseAt).toBeNull();
  });

  it('data de aplicação no futuro é rejeitada — registrar é aplicar', async () => {
    const { service, repo } = setup();
    await expect(service.create(ctx, { ...INPUT, appliedAt: '2026-10-10T12:00:00.000Z' })).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('aceita até um dia à frente (fuso e relógio de celular)', async () => {
    const { service } = setup();
    await expect(service.create(ctx, { ...INPUT, appliedAt: '2026-10-09T10:00:00.000Z' })).resolves.toBeDefined();
  });
});

describe('VaccinationService.create — registro externo (aplicada por outra pessoa)', () => {
  it('só controle: sem custo, sem produto, sem evento — mas com próxima dose', async () => {
    const { service, captured } = setup();

    await service.create(ctx, EXTERNAL_INPUT);

    expect(captured.data).toMatchObject({
      origin: 'external',
      productId: null,
      appliedBy: 'Dr. Fulano (CRMV-MG 1234)',
      pricePerDoseCents: 0,
      laborCents: 0,
      displacementKm: 0,
      totalCents: 0,
    });
    expect(captured.data?.nextDoseAt?.toISOString()).toBe('2027-03-01T12:00:00.000Z');
    expect(captured.event).toBeNull();
  });

  it('do catálogo: guarda o produto pra reconhecer a re-vacinação, ainda sem evento', async () => {
    const { service, captured } = setup();

    await service.create(ctx, { ...EXTERNAL_INPUT, productId: PRODUCT_ID, vaccineName: 'Influenza Equina' });

    expect(captured.data?.productId).toBe(PRODUCT_ID);
    expect(captured.event).toBeNull();
  });

  it('também não aceita data no futuro', async () => {
    const { service } = setup();
    await expect(
      service.create(ctx, { ...EXTERNAL_INPUT, appliedAt: '2026-12-01T12:00:00.000Z' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('sameVaccine', () => {
  const influenza = { productId: PRODUCT_ID, vaccineName: 'Influenza Equina' };

  it('com produto dos dois lados, compara o produto — o nome não importa', () => {
    expect(sameVaccine(influenza, { productId: PRODUCT_ID, vaccineName: 'Outro nome' })).toBe(true);
    expect(sameVaccine(influenza, { productId: OTHER_PRODUCT_ID, vaccineName: 'Influenza Equina' })).toBe(false);
  });

  it('se um lado é texto livre, compara o nome sem maiúsculas nem espaços nas pontas', () => {
    expect(sameVaccine(influenza, { productId: null, vaccineName: '  influenza equina ' })).toBe(true);
    expect(sameVaccine({ productId: null, vaccineName: 'Raiva' }, { productId: null, vaccineName: 'RAIVA' })).toBe(true);
    expect(sameVaccine(influenza, { productId: null, vaccineName: 'Raiva' })).toBe(false);
  });
});

describe('toBoosters — registros externos', () => {
  it('aplicação da clínica substitui o registro externo digitado da mesma vacina', () => {
    const boosters = toBoosters(
      [
        vaccination({ id: 'clinica', appliedAt: '2026-10-01T12:00:00.000Z', nextDoseAt: '2027-03-30T12:00:00.000Z' }),
        vaccination({
          id: 'externo',
          origin: 'external',
          productId: null,
          vaccineName: 'influenza equina',
          appliedAt: '2026-04-01T12:00:00.000Z',
          nextDoseAt: '2026-09-28T12:00:00.000Z',
        }),
      ],
      NOW,
    );

    expect(boosters.map((b) => b.lastVaccinationId)).toEqual(['clinica']);
  });

  it('registro externo sozinho gera o indicador normalmente', () => {
    const boosters = toBoosters(
      [vaccination({ id: 'externo', origin: 'external', productId: null, vaccineName: 'Raiva', nextDoseAt: '2026-10-10T12:00:00.000Z' })],
      NOW,
    );

    expect(boosters).toEqual([
      expect.objectContaining({ lastVaccinationId: 'externo', productId: null, status: 'due_soon' }),
    ]);
  });
});

describe('buildVaccinationAppliedEvent', () => {
  it('chave derivada da vacinação', () => {
    expect(buildVaccinationAppliedEvent(ctx, { ...vaccination(), productId: PRODUCT_ID }).idempotencyKey).toBe(
      deriveEventIdempotencyKey('vaccination.applied', VACCINATION_ID),
    );
  });
});

describe('VaccinationService.softDelete', () => {
  it('com custo: publica vaccination.deleted', async () => {
    const { service, repo } = setup();
    await service.softDelete(ctx, VACCINATION_ID);
    expect(repo.softDelete).toHaveBeenCalledWith(ctx, VACCINATION_ID, expect.objectContaining({ name: 'vaccination.deleted' }));
  });

  it('registro externo: não há pendência a cancelar', async () => {
    const { service, repo } = setup(vaccination({ origin: 'external', productId: null, totalCents: 0 }));
    await service.softDelete(ctx, VACCINATION_ID);
    expect(repo.softDelete).toHaveBeenCalledWith(ctx, VACCINATION_ID, null);
  });

  it('sem custo: não há pendência a cancelar', async () => {
    const { service, repo } = setup(vaccination({ totalCents: 0 }));
    await service.softDelete(ctx, VACCINATION_ID);
    expect(repo.softDelete).toHaveBeenCalledWith(ctx, VACCINATION_ID, null);
  });

  it('inexistente é 404', async () => {
    const { service } = setup(null);
    await expect(service.softDelete(ctx, VACCINATION_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('VaccinationService.listBoostersByAnimal', () => {
  it('monta o indicador a partir de todas as aplicações do animal', async () => {
    const { service, repo } = setup();
    vi.mocked(repo.listAllByAnimal).mockResolvedValue([vaccination()]);

    const boosters = await service.listBoostersByAnimal(ctx, ANIMAL_A);

    expect(repo.listAllByAnimal).toHaveBeenCalledWith(ctx, ANIMAL_A);
    expect(boosters).toHaveLength(1);
  });
});
