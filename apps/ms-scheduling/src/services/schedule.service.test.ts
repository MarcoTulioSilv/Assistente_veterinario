import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, ScheduleEvent } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ScheduleEventRepository } from '../repositories/schedule-event.repository';
import { ScheduleService, normalizeReminders, toEventData, checkRemindersNotPast } from './schedule.service';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 'trace-1',
};

const EVENT_ID = '33333333-3333-3333-3333-333333333333';
const OWNER_ID = '44444444-4444-4444-4444-444444444444';
const PROPERTY_ID = '55555555-5555-5555-5555-555555555555';
const APPOINTMENT_ID = '66666666-6666-6666-6666-666666666666';

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: EVENT_ID,
    activityType: 'visit',
    status: 'scheduled',
    startsAt: '2026-11-20T13:00:00.000Z',
    endsAt: null,
    ownerId: OWNER_ID,
    propertyId: PROPERTY_ID,
    animalIds: [],
    notes: null,
    reminderMinutesBefore: [60],
    sourceAppointmentId: null,
    createdBy: ctx.userId,
    completedAt: null,
    cancelledAt: null,
    createdAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<Record<keyof ScheduleEventRepository, unknown>> = {}): ScheduleEventRepository {
  return {
    findById: vi.fn().mockResolvedValue(event()),
    findActiveReturn: vi.fn().mockResolvedValue(null),
    listRange: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async () => event()),
    update: vi.fn().mockResolvedValue(event()),
    complete: vi.fn().mockResolvedValue(event({ status: 'done' })),
    cancel: vi.fn().mockResolvedValue(event({ status: 'cancelled' })),
    softDelete: vi.fn().mockResolvedValue(true),
    listRemindersDueAcrossTenants: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ScheduleEventRepository;
}

const NOW = new Date('2026-11-13T01:30:00Z'); // 22h30 do dia 12 em São Paulo

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

describe('normalizeReminders (RF-AGD-004)', () => {
  it('tira repetição e ordena', () => {
    expect(normalizeReminders([60, 15, 60], [])).toEqual([15, 60]);
  });

  it('recusa mais de 3 lembretes e antecedência fora de 0 a 7 dias', () => {
    const errors: Array<{ field: string; message: string }> = [];
    normalizeReminders([1, 2, 3, 4], errors);
    normalizeReminders([-5], errors);
    normalizeReminders([7 * 24 * 60 + 1], errors);
    normalizeReminders([1.5], errors);
    expect(errors).toHaveLength(4);
  });
});

describe('toEventData', () => {
  it('exige proprietário e propriedade fora de `other` (RF-AGD-002)', () => {
    expect(() => toEventData('visit', { startsAt: '2026-11-20T13:00:00Z' }, null, NOW)).toThrow(AppError);
  });

  it('`other` pode não ter cliente', () => {
    const data = toEventData('other', { startsAt: '2026-11-20T13:00:00Z' }, null, NOW);
    expect(data.ownerId).toBeNull();
    expect(data.propertyId).toBeNull();
  });

  it('recusa fim antes do início e data inválida', () => {
    const base = { ownerId: OWNER_ID, propertyId: PROPERTY_ID };
    expect(() =>
      toEventData('visit', { ...base, startsAt: '2026-11-20T13:00:00Z', endsAt: '2026-11-20T12:00:00Z' }, null, NOW),
    ).toThrow(AppError);
    expect(() => toEventData('visit', { ...base, startsAt: 'ontem' }, null, NOW)).toThrow(AppError);
  });

  it('limpa observação em branco e animais repetidos', () => {
    const data = toEventData(
      'visit',
      {
        startsAt: '2026-11-20T13:00:00Z',
        ownerId: OWNER_ID,
        propertyId: PROPERTY_ID,
        animalIds: ['a', 'a', 'b'],
        notes: '   ',
      },
      null,
      NOW,
    );
    expect(data.notes).toBeNull();
    expect(data.animalIds).toEqual(['a', 'b']);
  });
});

describe('ScheduleService.create / scheduleVisit', () => {
  it('cria com o tipo pedido e sem origem', async () => {
    const create = vi.fn().mockResolvedValue(event());
    const service = new ScheduleService(fakeRepo({ create }), () => NOW);

    await service.create(ctx, {
      activityType: 'vaccination',
      startsAt: '2026-11-20T13:00:00Z',
      ownerId: OWNER_ID,
      propertyId: PROPERTY_ID,
    });

    expect(create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ activityType: 'vaccination', sourceAppointmentId: null }),
    );
  });

  it('agendar visita: tipo sempre `visit`, com o atendimento de origem quando é retorno (RF-ATD-010)', async () => {
    const create = vi.fn().mockResolvedValue(event());
    const service = new ScheduleService(fakeRepo({ create }), () => NOW);

    await service.scheduleVisit(ctx, {
      startsAt: '2026-11-27T13:00:00Z',
      ownerId: OWNER_ID,
      propertyId: PROPERTY_ID,
      sourceAppointmentId: APPOINTMENT_ID,
    });

    expect(create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ activityType: 'visit', sourceAppointmentId: APPOINTMENT_ID }),
    );
  });

  it('visita sem retorno não tem origem', async () => {
    const create = vi.fn().mockResolvedValue(event());
    const service = new ScheduleService(fakeRepo({ create }), () => NOW);

    await service.scheduleVisit(ctx, { startsAt: '2026-11-27T13:00:00Z', ownerId: OWNER_ID, propertyId: PROPERTY_ID });

    expect(create).toHaveBeenCalledWith(ctx, expect.objectContaining({ sourceAppointmentId: null }));
  });
});

describe('ScheduleService.list (RF-AGD-001)', () => {
  it('repassa o intervalo e o filtro de status', async () => {
    const listRange = vi.fn().mockResolvedValue([]);
    const service = new ScheduleService(fakeRepo({ listRange }), () => NOW);

    await service.list(ctx, { from: '2026-11-01T03:00:00Z', to: '2026-12-01T03:00:00Z', status: 'scheduled' });

    expect(listRange).toHaveBeenCalledWith(
      ctx,
      new Date('2026-11-01T03:00:00Z'),
      new Date('2026-12-01T03:00:00Z'),
      'scheduled',
    );
  });

  it('recusa intervalo invertido e maior que 62 dias', async () => {
    const service = new ScheduleService(fakeRepo(), () => NOW);
    await expectAppError(service.list(ctx, { from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' }), 'VALIDATION_ERROR');
    await expectAppError(service.list(ctx, { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }), 'VALIDATION_ERROR');
    await expectAppError(service.list(ctx, { from: 'x', to: '2026-06-01T00:00:00Z' }), 'VALIDATION_ERROR');
  });
});

describe('ScheduleService.listDay (RF-AGD-003, RN-011)', () => {
  it('sem dia, usa o de hoje em São Paulo — não o de UTC — e deixa os cancelados de fora', async () => {
    const listRange = vi.fn().mockResolvedValue([]);
    const service = new ScheduleService(fakeRepo({ listRange }), () => NOW);

    await service.listDay(ctx);

    expect(listRange).toHaveBeenCalledWith(
      ctx,
      new Date('2026-11-12T03:00:00Z'),
      new Date('2026-11-13T03:00:00Z'),
      ['scheduled', 'done'],
    );
  });

  it('recusa dia fora do formato', async () => {
    const service = new ScheduleService(fakeRepo(), () => NOW);
    await expectAppError(service.listDay(ctx, '12/11/2026'), 'VALIDATION_ERROR');
    await expectAppError(service.listDay(ctx, '2026-13-45'), 'VALIDATION_ERROR');
  });
});

describe('ScheduleService.update', () => {
  it('não existe → 404; já concluído → 409', async () => {
    await expectAppError(
      new ScheduleService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), () => NOW).update(ctx, EVENT_ID, {}),
      'NOT_FOUND',
    );
    await expectAppError(
      new ScheduleService(fakeRepo({ findById: vi.fn().mockResolvedValue(event({ status: 'done' })) }), () => NOW).update(
        ctx,
        EVENT_ID,
        {},
      ),
      'CONFLICT',
    );
  });

  it('valida o evento como fica depois da edição: tirar a propriedade de uma visita não passa', async () => {
    const update = vi.fn();
    const service = new ScheduleService(fakeRepo({ update }), () => NOW);

    await expectAppError(service.update(ctx, EVENT_ID, { propertyId: null }), 'VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });

  it('novo fim antes do início que já existe não passa', async () => {
    const service = new ScheduleService(fakeRepo(), () => NOW);
    await expectAppError(service.update(ctx, EVENT_ID, { endsAt: '2026-11-20T12:00:00Z' }), 'VALIDATION_ERROR');
  });

  it('grava só o que mudou, já normalizado', async () => {
    const update = vi.fn().mockResolvedValue(event());
    const service = new ScheduleService(fakeRepo({ update }), () => NOW);

    await service.update(ctx, EVENT_ID, { startsAt: '2026-11-21T13:00:00Z', reminderMinutesBefore: [30, 30, 10], notes: ' ' });

    expect(update).toHaveBeenCalledWith(ctx, EVENT_ID, {
      startsAt: new Date('2026-11-21T13:00:00Z'),
      reminderMinutesBefore: [10, 30],
      notes: null,
    });
  });

  it('concluído entre a leitura e a gravação → 409', async () => {
    const service = new ScheduleService(fakeRepo({ update: vi.fn().mockResolvedValue(null) }), () => NOW);
    await expectAppError(service.update(ctx, EVENT_ID, { notes: 'x' }), 'CONFLICT');
  });
});

describe('ScheduleService.complete / cancel / remove', () => {
  it('conclui e cancela com a hora atual', async () => {
    const complete = vi.fn().mockResolvedValue(event({ status: 'done' }));
    const cancel = vi.fn().mockResolvedValue(event({ status: 'cancelled' }));
    const service = new ScheduleService(fakeRepo({ complete, cancel }), () => NOW);

    await service.complete(ctx, EVENT_ID);
    await service.cancel(ctx, EVENT_ID);

    expect(complete).toHaveBeenCalledWith(ctx, EVENT_ID, NOW);
    expect(cancel).toHaveBeenCalledWith(ctx, EVENT_ID, NOW);
  });

  it('transição recusada: 404 se não existe, 409 dizendo por quê se já saiu de `scheduled`', async () => {
    const missing = fakeRepo({ complete: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue(null) });
    await expectAppError(new ScheduleService(missing, () => NOW).complete(ctx, EVENT_ID), 'NOT_FOUND');

    const done = fakeRepo({
      cancel: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(event({ status: 'done' })),
    });
    const err = await expectAppError(new ScheduleService(done, () => NOW).cancel(ctx, EVENT_ID), 'CONFLICT');
    expect(err.message).toBe('Evento já foi concluído');

    const cancelled = fakeRepo({
      complete: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(event({ status: 'cancelled' })),
    });
    const err2 = await expectAppError(new ScheduleService(cancelled, () => NOW).complete(ctx, EVENT_ID), 'CONFLICT');
    expect(err2.message).toBe('Evento já foi cancelado');
  });

  it('excluir o que não existe → 404', async () => {
    const service = new ScheduleService(fakeRepo({ softDelete: vi.fn().mockResolvedValue(false) }), () => NOW);
    await expectAppError(service.remove(ctx, EVENT_ID), 'NOT_FOUND');
  });

  it('findById e findReturn repassam ao repositório', async () => {
    const findActiveReturn = vi.fn().mockResolvedValue(event({ sourceAppointmentId: APPOINTMENT_ID }));
    const service = new ScheduleService(fakeRepo({ findActiveReturn }), () => NOW);

    expect((await service.findReturn(ctx, APPOINTMENT_ID))?.sourceAppointmentId).toBe(APPOINTMENT_ID);
    expect((await service.findById(ctx, EVENT_ID))?.id).toBe(EVENT_ID);
  });
});

describe('checkRemindersNotPast', () => {
  const startsAt = new Date('2026-11-13T02:30:00Z'); // 1h depois de NOW

  it('aceita lembrete agora ou no futuro', () => {
    const errors: Array<{ field: string; message: string }> = [];
    checkRemindersNotPast(startsAt, [0, 15, 60], NOW, errors);
    expect(errors).toEqual([]);
  });

  it('recusa lembrete que cairia antes de agora', () => {
    const errors: Array<{ field: string; message: string }> = [];
    checkRemindersNotPast(startsAt, [15, 61], NOW, errors);
    expect(errors).toEqual([{ field: 'reminderMinutesBefore', message: 'Lembrete cairia no passado' }]);
  });
});

describe('lembrete no passado', () => {
  it('criar evento com lembrete que já passou → 422', async () => {
    const service = new ScheduleService(fakeRepo(), () => NOW);
    const err = await expectAppError(
      service.scheduleVisit(ctx, {
        startsAt: '2026-11-13T02:00:00Z', // 30 min depois de NOW
        ownerId: OWNER_ID,
        propertyId: PROPERTY_ID,
        reminderMinutesBefore: [60],
      }),
      'VALIDATION_ERROR',
    );
    expect(err.details).toEqual([{ field: 'reminderMinutesBefore', message: 'Lembrete cairia no passado' }]);
  });

  it('evento no passado sem lembrete é aceito (registrar visita feita)', async () => {
    const create = vi.fn().mockResolvedValue(event());
    const service = new ScheduleService(fakeRepo({ create }), () => NOW);

    await service.scheduleVisit(ctx, { startsAt: '2026-11-01T13:00:00Z', ownerId: OWNER_ID, propertyId: PROPERTY_ID });

    expect(create).toHaveBeenCalled();
  });

  it('na edição, mudar horário ou lembretes para o passado → 422', async () => {
    const service = new ScheduleService(fakeRepo(), () => NOW);
    await expectAppError(service.update(ctx, EVENT_ID, { startsAt: '2026-11-13T02:00:00Z' }), 'VALIDATION_ERROR');
    await expectAppError(
      new ScheduleService(fakeRepo({ findById: vi.fn().mockResolvedValue(event({ startsAt: '2026-11-13T02:00:00.000Z', reminderMinutesBefore: [] })) }), () => NOW)
        .update(ctx, EVENT_ID, { reminderMinutesBefore: [60] }),
      'VALIDATION_ERROR',
    );
  });

  it('na edição, mexer só na observação de evento cujo lembrete já disparou continua possível', async () => {
    const update = vi.fn().mockResolvedValue(event());
    const fired = event({ startsAt: '2026-11-13T02:00:00.000Z', reminderMinutesBefore: [60] });
    const service = new ScheduleService(fakeRepo({ findById: vi.fn().mockResolvedValue(fired), update }), () => NOW);

    await service.update(ctx, EVENT_ID, { notes: 'levar ferrador' });

    expect(update).toHaveBeenCalledWith(ctx, EVENT_ID, { notes: 'levar ferrador' });
  });
});
