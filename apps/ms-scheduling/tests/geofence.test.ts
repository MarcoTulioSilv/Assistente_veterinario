/**
 * Geofence contra Postgres de verdade, com a role da aplicação.
 *
 * O que só um teste assim prova:
 *  - as consultas de pendência (retorno vencido, de hoje ou dos próximos 2
 *    dias; visita mais velha que X dias) e o que fica de fora;
 *  - a UNIQUE (tenant, propriedade, dia): um aviso por propriedade por dia;
 *  - publicação que falha desfaz o registro do dia (o aparelho pode tentar
 *    de novo);
 *  - RLS e CHECKs das tabelas novas.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { admin, purgeTenants } from './admin-db';
import { GeofenceRepository } from '../src/repositories/geofence.repository';
import { GeofenceService } from '../src/services/geofence.service';

const TENANT_A = 'd5000000-0000-0000-0000-000000000000';
const TENANT_B = 'd6000000-0000-0000-0000-000000000000';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'plus', traceId: `trace-${randomUUID()}` };
}
const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

// 27/11/2026 10:00 em São Paulo.
const NOW = new Date('2026-11-27T13:00:00Z');
const repo = new GeofenceRepository();

function serviceWith(publish = vi.fn().mockResolvedValue(undefined)): GeofenceService {
  return new GeofenceService(repo, publish, () => NOW);
}

async function returnVisit(
  tenantId: string,
  propertyId: string,
  startsAt: string,
  extra: { status?: 'scheduled' | 'done' | 'cancelled'; deletedAt?: Date } = {},
): Promise<string> {
  const status = extra.status ?? 'scheduled';
  const row = await admin.scheduleEvent.create({
    data: {
      tenantId,
      activityType: 'visit',
      status,
      startsAt: new Date(startsAt),
      ownerId: randomUUID(),
      propertyId,
      sourceAppointmentId: randomUUID(),
      createdBy: randomUUID(),
      completedAt: status === 'done' ? NOW : null,
      cancelledAt: status === 'cancelled' ? NOW : null,
      deletedAt: extra.deletedAt ?? null,
    },
  });
  return row.id;
}

async function lastVisit(tenantId: string, propertyId: string, at: string): Promise<void> {
  await admin.propertyLastVisit.create({
    data: { tenantId, propertyId, lastVisitAt: new Date(at), sourceType: 'appointment', sourceId: randomUUID() },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  await purgeTenants(TENANT_A, TENANT_B);
});

afterAll(async () => {
  await admin.$disconnect();
  await prisma.$disconnect();
});

describe('alvos do geofence (RN-008)', () => {
  it('retorno vencido, de hoje e de até 2 dias entra; o de 3 dias, concluído, cancelado ou excluído não', async () => {
    const overdue = randomUUID();
    const inTwoDays = randomUUID();
    const inThreeDays = randomUUID();
    const done = randomUUID();
    const overdueId = await returnVisit(TENANT_A, overdue, '2026-11-20T13:00:00Z');
    const lateTonight = await returnVisit(TENANT_A, inTwoDays, '2026-11-30T02:59:00Z'); // 29/11 23:59 em SP
    await returnVisit(TENANT_A, inThreeDays, '2026-11-30T03:00:00Z'); // 30/11 00:00 em SP
    await returnVisit(TENANT_A, done, '2026-11-26T13:00:00Z', { status: 'done' });
    await returnVisit(TENANT_A, done, '2026-11-26T13:00:00Z', { status: 'cancelled' });
    await returnVisit(TENANT_A, done, '2026-11-26T13:00:00Z', { deletedAt: NOW });

    const { targets } = await serviceWith().targets(ctxA);

    expect(targets).toEqual([
      { propertyId: overdue, reasons: ['return_pending'], returnEventIds: [overdueId], lastVisitAt: null },
      { propertyId: inTwoDays, reasons: ['return_pending'], returnEventIds: [lateTonight], lastVisitAt: null },
    ]);
  });

  it('visita mais velha que X dias entra; recente e de outra clínica não', async () => {
    const old = randomUUID();
    await lastVisit(TENANT_A, old, '2026-08-01T12:00:00Z'); // 118 dias
    await lastVisit(TENANT_A, randomUUID(), '2026-10-01T12:00:00Z'); // 57 dias
    await lastVisit(TENANT_B, randomUUID(), '2026-01-01T12:00:00Z');

    const { targets, noVisitDays, radiusMeters } = await serviceWith().targets(ctxA);

    expect({ noVisitDays, radiusMeters }).toEqual({ noVisitDays: 90, radiusMeters: 2000 });
    expect(targets.map((t) => [t.propertyId, t.reasons])).toEqual([[old, ['no_recent_visit']]]);

    // X da clínica: com 30 dias, a de 57 dias também entra.
    await serviceWith().updateSettings(ctxA, { noVisitDays: 30 });
    expect((await serviceWith().targets(ctxA)).targets).toHaveLength(2);
  });
});

describe('aviso ao entrar no raio', () => {
  it('publica uma vez por propriedade por dia, mesmo com dois aparelhos', async () => {
    const property = randomUUID();
    await lastVisit(TENANT_A, property, '2026-06-01T12:00:00Z');
    const publish = vi.fn().mockResolvedValue(undefined);

    await expect(serviceWith(publish).hit(ctxA, property)).resolves.toEqual({ triggered: true, reasons: ['no_recent_visit'] });
    await expect(serviceWith(publish).hit({ ...ctxA, userId: randomUUID() }, property)).resolves.toMatchObject({
      triggered: false,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const hits = await admin.geofenceHit.findMany({ where: { tenantId: TENANT_A } });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ propertyId: property, userId: ctxA.userId, reasons: ['no_recent_visit'] });
    expect(hits[0]!.day.toISOString().slice(0, 10)).toBe('2026-11-27');
  });

  it('propriedade sem pendência (inclusive a nunca visitada) não grava nada', async () => {
    await expect(serviceWith().hit(ctxA, randomUUID())).resolves.toEqual({ triggered: false, reasons: [] });
    expect(await admin.geofenceHit.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('se a publicação falhar, o registro do dia volta e a próxima tentativa avisa', async () => {
    const property = randomUUID();
    await lastVisit(TENANT_A, property, '2026-06-01T12:00:00Z');

    await expect(serviceWith(vi.fn().mockRejectedValue(new Error('Redis fora'))).hit(ctxA, property)).rejects.toThrow(
      'Redis fora',
    );
    expect(await admin.geofenceHit.count({ where: { tenantId: TENANT_A } })).toBe(0);

    await expect(serviceWith().hit(ctxA, property)).resolves.toMatchObject({ triggered: true });
  });
});

describe('banco: RLS e CHECKs', () => {
  it('a configuração de uma clínica não vale para a outra', async () => {
    await serviceWith().updateSettings(ctxA, { radiusMeters: 300 });

    await expect(serviceWith().getSettings(ctxA)).resolves.toEqual({ radiusMeters: 300, noVisitDays: 90 });
    await expect(serviceWith().getSettings(ctxB)).resolves.toEqual({ radiusMeters: 2000, noVisitDays: 90 });
  });

  it('o CHECK recusa raio fora do limite mesmo sem passar pelo service', async () => {
    await expect(
      withTenant(TENANT_A, (tx) => tx.geofenceSettings.create({ data: { tenantId: TENANT_A, radiusMeters: 10, noVisitDays: 90 } })),
    ).rejects.toThrow(/check constraint|geofence_settings_radius_range/i);
  });

  it('o CHECK recusa aviso sem motivo ou com motivo desconhecido', async () => {
    const base = { tenantId: TENANT_A, propertyId: randomUUID(), day: new Date('2026-11-27'), userId: randomUUID() };
    await expect(withTenant(TENANT_A, (tx) => tx.geofenceHit.create({ data: { ...base, reasons: [] } }))).rejects.toThrow();
    await expect(
      withTenant(TENANT_A, (tx) => tx.geofenceHit.create({ data: { ...base, reasons: ['qualquer'] } })),
    ).rejects.toThrow();
  });

  it('gravar aviso com o tenant de outra clínica é recusado pelo RLS', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.geofenceHit.create({
          data: { tenantId: TENANT_B, propertyId: randomUUID(), day: new Date('2026-11-27'), userId: randomUUID(), reasons: ['no_recent_visit'] },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
