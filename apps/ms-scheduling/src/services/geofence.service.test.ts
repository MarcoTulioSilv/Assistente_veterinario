import { describe, it, expect, vi } from 'vitest';
import { GEOFENCE_DEFAULTS, EVENTS } from '@quironequine/shared-types';
import type { RequestContext, DomainEvent, GeofenceTriggeredPayload } from '@quironequine/shared-types';
import { GeofenceService } from './geofence.service';
import type { GeofenceRepository } from '../repositories/geofence.repository';

const PROPERTY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROPERTY_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const RETURN_1 = 'bbbbbbbb-0000-0000-0000-000000000001';

// 27/11/2026 10:00 em São Paulo.
const NOW = new Date('2026-11-27T13:00:00Z');

const ctx = (plan: 'basic' | 'plus' = 'plus'): RequestContext => ({
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan,
  traceId: 'trace-geofence',
});

function fakeRepo(overrides: Partial<GeofenceRepository> = {}): GeofenceRepository {
  return {
    getSettings: vi.fn().mockResolvedValue(GEOFENCE_DEFAULTS),
    upsertSettings: vi.fn(async (_ctx, data) => ({ ...GEOFENCE_DEFAULTS, ...data })),
    listPendingReturns: vi.fn().mockResolvedValue([]),
    listStaleVisits: vi.fn().mockResolvedValue([]),
    listLastVisits: vi.fn().mockResolvedValue([]),
    recordHit: vi.fn(async (_ctx, _hit, publish: () => Promise<void>) => {
      await publish();
      return true;
    }),
    ...overrides,
  } as unknown as GeofenceRepository;
}

function service(repo: GeofenceRepository, publish = vi.fn().mockResolvedValue(undefined)): GeofenceService {
  return new GeofenceService(repo, publish, () => NOW);
}

describe('GeofenceService: plano', () => {
  it('é recurso do Plano Plus: o Básico recebe 403 em todas as operações', async () => {
    const s = service(fakeRepo());
    await expect(s.getSettings(ctx('basic'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(s.updateSettings(ctx('basic'), { radiusMeters: 300 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(s.targets(ctx('basic'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(s.hit(ctx('basic'), PROPERTY_A)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('GeofenceService.updateSettings', () => {
  it('grava só o que veio', async () => {
    const repo = fakeRepo();
    await service(repo).updateSettings(ctx(), { noVisitDays: 60 });
    expect(repo.upsertSettings).toHaveBeenCalledWith(ctx(), { noVisitDays: 60 });
  });

  it('recusa raio e dias fora dos limites, com o campo no erro', async () => {
    const repo = fakeRepo();
    await expect(service(repo).updateSettings(ctx(), { radiusMeters: 10, noVisitDays: 0 })).rejects.toMatchObject({
      statusCode: 422,
      details: [expect.objectContaining({ field: 'radiusMeters' }), expect.objectContaining({ field: 'noVisitDays' })],
    });
    await expect(service(repo).updateSettings(ctx(), { radiusMeters: 250.5 })).rejects.toMatchObject({ statusCode: 422 });
    expect(repo.upsertSettings).not.toHaveBeenCalled();
  });
});

describe('GeofenceService.targets', () => {
  it('retornos até o fim de depois de amanhã (São Paulo) e visitas mais velhas que X dias', async () => {
    const repo = fakeRepo({ getSettings: vi.fn().mockResolvedValue({ radiusMeters: 500, noVisitDays: 90 }) });
    await service(repo).targets(ctx());

    // Hoje = 27/11; conta até 29/11 inteiro → antes de 30/11 00:00 de São Paulo (03:00 UTC).
    expect(repo.listPendingReturns).toHaveBeenCalledWith(ctx(), new Date('2026-11-30T03:00:00Z'), undefined);
    expect(repo.listStaleVisits).toHaveBeenCalledWith(ctx(), new Date(NOW.getTime() - 90 * 86_400_000), undefined);
  });

  it('junta os motivos por propriedade e traz a última visita de quem só tem retorno', async () => {
    const repo = fakeRepo({
      listPendingReturns: vi.fn().mockResolvedValue([
        { id: RETURN_1, propertyId: PROPERTY_A, startsAt: new Date('2026-11-28T12:00:00Z') },
      ]),
      listStaleVisits: vi.fn().mockResolvedValue([{ propertyId: PROPERTY_B, lastVisitAt: new Date('2026-06-01T12:00:00Z') }]),
      listLastVisits: vi.fn().mockResolvedValue([{ propertyId: PROPERTY_A, lastVisitAt: new Date('2026-11-20T12:00:00Z') }]),
    });

    const result = await service(repo).targets(ctx());

    expect(repo.listLastVisits).toHaveBeenCalledWith(ctx(), [PROPERTY_A]);
    expect(result).toEqual({
      radiusMeters: 500,
      noVisitDays: 90,
      targets: [
        { propertyId: PROPERTY_A, reasons: ['return_pending'], returnEventIds: [RETURN_1], lastVisitAt: '2026-11-20T12:00:00.000Z' },
        { propertyId: PROPERTY_B, reasons: ['no_recent_visit'], returnEventIds: [], lastVisitAt: '2026-06-01T12:00:00.000Z' },
      ],
    });
  });

  it('propriedade com retorno e visita antiga vira um alvo só, com os dois motivos', async () => {
    const repo = fakeRepo({
      listPendingReturns: vi.fn().mockResolvedValue([
        { id: RETURN_1, propertyId: PROPERTY_A, startsAt: new Date('2026-11-26T12:00:00Z') },
      ]),
      listStaleVisits: vi.fn().mockResolvedValue([{ propertyId: PROPERTY_A, lastVisitAt: new Date('2026-01-01T12:00:00Z') }]),
    });

    const { targets } = await service(repo).targets(ctx());

    expect(targets).toEqual([
      { propertyId: PROPERTY_A, reasons: ['return_pending', 'no_recent_visit'], returnEventIds: [RETURN_1], lastVisitAt: '2026-01-01T12:00:00.000Z' },
    ]);
    expect(repo.listLastVisits).toHaveBeenCalledWith(ctx(), []);
  });
});

describe('GeofenceService.hit', () => {
  it('sem pendência: não grava nem publica', async () => {
    const repo = fakeRepo();
    const publish = vi.fn();

    await expect(service(repo, publish).hit(ctx(), PROPERTY_A)).resolves.toEqual({ triggered: false, reasons: [] });
    expect(repo.listPendingReturns).toHaveBeenCalledWith(ctx(), expect.any(Date), PROPERTY_A);
    expect(repo.recordHit).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('com pendência: grava o dia de São Paulo e publica para quem estava com o aparelho', async () => {
    const repo = fakeRepo({
      listStaleVisits: vi.fn().mockResolvedValue([{ propertyId: PROPERTY_A, lastVisitAt: new Date('2026-06-01T12:00:00Z') }]),
    });
    const publish = vi.fn().mockResolvedValue(undefined);

    const result = await service(repo, publish).hit(ctx(), PROPERTY_A);

    expect(result).toEqual({ triggered: true, reasons: ['no_recent_visit'] });
    expect(repo.recordHit).toHaveBeenCalledWith(
      ctx(),
      { propertyId: PROPERTY_A, day: '2026-11-27', userId: ctx().userId, reasons: ['no_recent_visit'] },
      expect.any(Function),
    );
    const event = publish.mock.calls[0]![0] as DomainEvent<GeofenceTriggeredPayload>;
    expect(event.name).toBe(EVENTS.GEOFENCE_TRIGGERED);
    expect(event.payload).toEqual({
      propertyId: PROPERTY_A,
      reasons: ['no_recent_visit'],
      returnEventIds: [],
      lastVisitAt: '2026-06-01T12:00:00.000Z',
      recipientUserId: ctx().userId,
    });
  });

  it('já avisou hoje: não publica de novo', async () => {
    const repo = fakeRepo({
      listStaleVisits: vi.fn().mockResolvedValue([{ propertyId: PROPERTY_A, lastVisitAt: new Date('2026-06-01T12:00:00Z') }]),
      recordHit: vi.fn().mockResolvedValue(false),
    });
    const publish = vi.fn();

    await expect(service(repo, publish).hit(ctx(), PROPERTY_A)).resolves.toEqual({ triggered: false, reasons: ['no_recent_visit'] });
    expect(publish).not.toHaveBeenCalled();
  });

  it('a chave do evento é a mesma para a mesma propriedade no mesmo dia', async () => {
    const stale = [{ propertyId: PROPERTY_A, lastVisitAt: new Date('2026-06-01T12:00:00Z') }];
    const publish = vi.fn().mockResolvedValue(undefined);
    await service(fakeRepo({ listStaleVisits: vi.fn().mockResolvedValue(stale) }), publish).hit(ctx(), PROPERTY_A);
    await service(fakeRepo({ listStaleVisits: vi.fn().mockResolvedValue(stale) }), publish).hit(
      { ...ctx(), userId: '33333333-3333-3333-3333-333333333333' },
      PROPERTY_A,
    );

    const [first, second] = publish.mock.calls.map((c) => (c[0] as DomainEvent).idempotencyKey);
    expect(first).toBe(second);
  });
});
