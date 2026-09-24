import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, Appointment } from '@quironequine/shared-types';
import type { AppointmentRepository } from '../repositories/appointment.repository';
import {
  AppointmentService,
  calculateTotalCents,
  calculateItemTotalCents,
  deriveEventIdempotencyKey,
  toConsumedItems,
  buildAppointmentDoneEvent,
} from './appointment.service';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 'trace-teste',
};

const APPOINTMENT_ID = '33333333-3333-3333-3333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-4444-444444444444';

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: APPOINTMENT_ID,
    ownerId: '55555555-5555-5555-5555-555555555555',
    propertyId: '66666666-6666-6666-6666-666666666666',
    animalId: '77777777-7777-7777-7777-777777777777',
    veterinarianId: '88888888-8888-8888-8888-888888888888',
    type: 'clinico_geral',
    status: 'draft',
    animalLocation: null,
    performedAt: '2026-09-24T12:00:00.000Z',
    laborCents: 0,
    displacementKm: 0,
    displacementRateCents: 0,
    totalCents: 0,
    finishedAt: null,
    createdAt: '2026-09-24T12:00:00.000Z',
    items: [],
    prescriptions: [],
    medicalRecord: null,
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<AppointmentRepository> = {}): AppointmentRepository {
  return {
    list: vi.fn(),
    listByAnimal: vi.fn(),
    findById: vi.fn().mockResolvedValue(appointment()),
    create: vi.fn().mockResolvedValue(appointment()),
    update: vi.fn().mockResolvedValue(appointment()),
    finish: vi.fn().mockResolvedValue(appointment({ status: 'finished' })),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AppointmentRepository;
}

describe('calculateTotalCents (RF-ATD-006)', () => {
  it('soma itens, mão de obra e deslocamento (km × valor/km)', () => {
    const total = calculateTotalCents({
      items: [{ totalCents: 5000 }, { totalCents: 2500 }],
      laborCents: 10000,
      displacementKm: 30,
      displacementRateCents: 250,
    });

    expect(total).toBe(5000 + 2500 + 10000 + 7500);
  });

  it('arredonda o deslocamento uma vez, no fim — não por km', () => {
    // 12,5 km × R$ 1,33 = 1662,5 centavos. Arredondar por km daria 12×133 + 0,5×133.
    expect(
      calculateTotalCents({ items: [], laborCents: 0, displacementKm: 12.5, displacementRateCents: 133 }),
    ).toBe(1663);
  });

  it('atendimento sem nada custa zero', () => {
    expect(
      calculateTotalCents({ items: [], laborCents: 0, displacementKm: 0, displacementRateCents: 0 }),
    ).toBe(0);
  });
});

describe('calculateItemTotalCents', () => {
  it('multiplica quantidade por preço unitário', () => {
    expect(calculateItemTotalCents(3, 1500)).toBe(4500);
  });

  it('quantidade fracionada (meia ampola) arredonda para centavo inteiro', () => {
    expect(calculateItemTotalCents(0.5, 999)).toBe(500);
  });
});

describe('deriveEventIdempotencyKey', () => {
  it('é determinística: o mesmo atendimento gera sempre a mesma chave', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toBe(
      deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID),
    );
  });

  it('atendimentos diferentes geram chaves diferentes', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.done', '99999999-9999-9999-9999-999999999999'),
    );
  });

  it('eventos diferentes do mesmo atendimento não colidem na UNIQUE do outbox', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.cancelled', APPOINTMENT_ID),
    );
  });

  it('tem formato de UUID — a coluna é @db.Uuid de verdade', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('toConsumedItems (RN-003)', () => {
  it('só itens de estoque viram baixa — procedimento fica de fora', () => {
    const consumidos = toConsumedItems(
      appointment({
        items: [
          { id: 'i1', kind: 'product', productId: PRODUCT_ID, description: 'Vacina', quantity: 2, unitPriceCents: 100, totalCents: 200 },
          { id: 'i2', kind: 'procedure', productId: null, description: 'Consulta', quantity: 1, unitPriceCents: 9000, totalCents: 9000 },
        ],
      }),
    );

    expect(consumidos).toEqual([{ productId: PRODUCT_ID, quantity: 2 }]);
  });

  it('atendimento só com procedimento não consome nada', () => {
    const consumidos = toConsumedItems(
      appointment({
        items: [
          { id: 'i1', kind: 'procedure', productId: null, description: 'Consulta', quantity: 1, unitPriceCents: 9000, totalCents: 9000 },
        ],
      }),
    );

    expect(consumidos).toEqual([]);
  });
});

describe('buildAppointmentDoneEvent', () => {
  it('monta o envelope com tenant, trace e chave derivada do atendimento', () => {
    const event = buildAppointmentDoneEvent(ctx, appointment(), 12345);

    expect(event.name).toBe('appointment.done');
    expect(event.tenantId).toBe(ctx.tenantId);
    expect(event.traceId).toBe(ctx.traceId);
    expect(event.idempotencyKey).toBe(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID));
    expect(event.payload.totalCostCents).toBe(12345);
    expect(event.payload.appointmentId).toBe(APPOINTMENT_ID);
  });
});

describe('AppointmentService.create', () => {
  it('calcula o total do item e do atendimento antes de gravar', async () => {
    const create = vi.fn().mockResolvedValue(appointment());
    const service = new AppointmentService(fakeRepo({ create }));

    await service.create(ctx, {
      ownerId: '55555555-5555-5555-5555-555555555555',
      propertyId: '66666666-6666-6666-6666-666666666666',
      animalId: '77777777-7777-7777-7777-777777777777',
      veterinarianId: '88888888-8888-8888-8888-888888888888',
      type: 'clinico_geral',
      performedAt: '2026-09-24T12:00:00.000Z',
      laborCents: 10000,
      displacementKm: 10,
      displacementRateCents: 200,
      items: [{ kind: 'product', productId: PRODUCT_ID, description: 'Vacina', quantity: 2, unitPriceCents: 1500 }],
    });

    const data = create.mock.calls[0]![1];
    expect(data.items[0].totalCents).toBe(3000);
    expect(data.totalCents).toBe(3000 + 10000 + 2000);
  });
});

describe('AppointmentService.update', () => {
  it('rejeita quando o atendimento não existe', async () => {
    const service = new AppointmentService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.update(ctx, APPOINTMENT_ID, { laborCents: 1 })).rejects.toThrow(/não encontrado/);
  });

  it('rejeita editar atendimento já finalizado — orçamento congelado', async () => {
    const service = new AppointmentService(
      fakeRepo({ findById: vi.fn().mockResolvedValue(appointment({ status: 'finished' })) }),
    );

    await expect(service.update(ctx, APPOINTMENT_ID, { laborCents: 1 })).rejects.toThrow(/congelado/);
  });

  it('recalcula o total usando o que não mudou', async () => {
    const update = vi.fn().mockResolvedValue(appointment());
    const service = new AppointmentService(
      fakeRepo({
        findById: vi.fn().mockResolvedValue(
          appointment({
            laborCents: 5000,
            displacementKm: 10,
            displacementRateCents: 100,
            items: [
              { id: 'i1', kind: 'procedure', productId: null, description: 'Consulta', quantity: 1, unitPriceCents: 2000, totalCents: 2000 },
            ],
          }),
        ),
        update,
      }),
    );

    // Só a mão de obra muda; itens e deslocamento vêm do que está gravado.
    await service.update(ctx, APPOINTMENT_ID, { laborCents: 7000 });

    expect(update.mock.calls[0]![2].totalCents).toBe(2000 + 7000 + 1000);
  });
});

describe('AppointmentService.finish (RF-ATD-008 + RN-003)', () => {
  it('rejeita quando o atendimento não existe', async () => {
    const service = new AppointmentService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.finish(ctx, APPOINTMENT_ID)).rejects.toThrow(/não encontrado/);
  });

  it('rejeita finalizar duas vezes', async () => {
    const service = new AppointmentService(
      fakeRepo({ findById: vi.fn().mockResolvedValue(appointment({ status: 'finished' })) }),
    );

    await expect(service.finish(ctx, APPOINTMENT_ID)).rejects.toThrow(/já finalizado/);
  });

  it('rejeita finalizar atendimento cancelado', async () => {
    const service = new AppointmentService(
      fakeRepo({ findById: vi.fn().mockResolvedValue(appointment({ status: 'cancelled' })) }),
    );

    await expect(service.finish(ctx, APPOINTMENT_ID)).rejects.toThrow(/cancelado/);
  });

  it('congela o total recalculado e manda o evento junto, pro repo gravar em transação', async () => {
    const finish = vi.fn().mockResolvedValue(appointment({ status: 'finished' }));
    const service = new AppointmentService(
      fakeRepo({
        findById: vi.fn().mockResolvedValue(
          appointment({
            laborCents: 10000,
            items: [
              { id: 'i1', kind: 'product', productId: PRODUCT_ID, description: 'Vacina', quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
            ],
          }),
        ),
        finish,
      }),
    );

    await service.finish(ctx, APPOINTMENT_ID);

    const [, , totalCents, event] = finish.mock.calls[0]!;
    expect(totalCents).toBe(13000);
    expect(event.payload.totalCostCents).toBe(13000);
    expect(event.payload.consumedItems).toEqual([{ productId: PRODUCT_ID, quantity: 2 }]);
  });
});

describe('AppointmentService.softDelete', () => {
  it('rejeita quando o atendimento não existe', async () => {
    const service = new AppointmentService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.softDelete(ctx, APPOINTMENT_ID)).rejects.toThrow(/não encontrado/);
  });

  it('remove (soft delete) quando existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new AppointmentService(fakeRepo({ softDelete }));

    await service.softDelete(ctx, APPOINTMENT_ID);

    expect(softDelete).toHaveBeenCalledWith(ctx, APPOINTMENT_ID);
  });
});

describe('AppointmentService — delegações simples', () => {
  it('list e listByAnimal repassam pro repositório', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const listByAnimal = vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const service = new AppointmentService(fakeRepo({ list, listByAnimal }));

    await service.list(ctx, { page: 1, limit: 20 });
    await service.listByAnimal(ctx, '77777777-7777-7777-7777-777777777777', { page: 1, limit: 20 });

    expect(list).toHaveBeenCalledWith(ctx, { page: 1, limit: 20 });
    expect(listByAnimal).toHaveBeenCalledWith(ctx, '77777777-7777-7777-7777-777777777777', { page: 1, limit: 20 });
  });
});
