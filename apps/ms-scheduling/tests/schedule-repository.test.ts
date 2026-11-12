/**
 * Integração da agenda contra Postgres de verdade, com a role da aplicação.
 *
 * O que só um teste assim prova:
 *  - o RLS isola a agenda entre tenants;
 *  - o índice único parcial: um retorno ATIVO por atendimento, liberado ao
 *    cancelar ou excluir;
 *  - os CHECKs barram o que o service deixasse passar por engano;
 *  - concluir com propriedade grava a última visita na mesma transação;
 *  - a última visita só avança (redelivery e ordem trocada não mudam nada);
 *  - a função SECURITY DEFINER dos lembretes enxerga todos os tenants, só
 *    na janela e só eventos agendados.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext, DomainEvent } from '@quironequine/shared-types';
import { prisma, withTenant } from '../src/prisma';
import { admin, purgeTenants } from './admin-db';
import { ScheduleEventRepository } from '../src/repositories/schedule-event.repository';
import { LastVisitRepository } from '../src/repositories/last-visit.repository';
import { ScheduleService } from '../src/services/schedule.service';
import { LastVisitService } from '../src/services/last-visit.service';

const TENANT_A = 'd3000000-0000-0000-0000-000000000000';
const TENANT_B = 'd4000000-0000-0000-0000-000000000000';

function ctxFor(tenantId: string): RequestContext {
  return { tenantId, userId: randomUUID(), role: 'admin', plan: 'basic', traceId: `trace-${randomUUID()}` };
}

const ctxA = ctxFor(TENANT_A);
const ctxB = ctxFor(TENANT_B);

const repo = new ScheduleEventRepository();
const lastVisits = new LastVisitRepository();
const NOW = new Date('2026-11-12T13:00:00Z');
const service = new ScheduleService(repo, () => NOW);
const lastVisitService = new LastVisitService(lastVisits);

const OWNER_ID = randomUUID();
const PROPERTY_ID = randomUUID();

function visit(startsAt: string, extra: Record<string, unknown> = {}) {
  return { startsAt, ownerId: OWNER_ID, propertyId: PROPERTY_ID, reminderMinutesBefore: [60], ...extra };
}

function appointmentDone(tenantId: string, performedAt: string, propertyId = PROPERTY_ID): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId,
    traceId: `trace-${randomUUID()}`,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { appointmentId: randomUUID(), ownerId: OWNER_ID, totalCostCents: 0, consumedItems: [], performedAt, propertyId },
  };
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

describe('agenda (RF-AGD-001 a 003)', () => {
  it('lista o intervalo em ordem cronológica e não mostra a agenda de outro tenant', async () => {
    await service.scheduleVisit(ctxA, visit('2026-11-20T15:00:00Z'));
    await service.scheduleVisit(ctxA, visit('2026-11-20T11:00:00Z'));
    await service.scheduleVisit(ctxB, visit('2026-11-20T12:00:00Z'));

    const events = await service.list(ctxA, { from: '2026-11-01T03:00:00Z', to: '2026-12-01T03:00:00Z' });

    expect(events.map((e) => e.startsAt)).toEqual(['2026-11-20T11:00:00.000Z', '2026-11-20T15:00:00.000Z']);
  });

  it('o dia é o de São Paulo e os cancelados ficam de fora (RN-011)', async () => {
    // 23h30 do dia 12 em São Paulo = 02h30 UTC do dia 13: é do dia 12.
    const late = await service.scheduleVisit(ctxA, visit('2026-11-13T02:30:00Z'));
    const cancelled = await service.scheduleVisit(ctxA, visit('2026-11-12T14:00:00Z'));
    await service.cancel(ctxA, cancelled.id);
    await service.scheduleVisit(ctxA, visit('2026-11-13T03:30:00Z')); // já é dia 13

    const today = await service.listDay(ctxA, '2026-11-12');

    expect(today.map((e) => e.id)).toEqual([late.id]);
  });

  it('grava quem agendou e registra a criação no audit_log, sem valores', async () => {
    const created = await service.scheduleVisit(ctxA, visit('2026-11-20T15:00:00Z', { notes: 'Égua mancando' }));

    expect(created.createdBy).toBe(ctxA.userId);
    const audit = await withTenant(TENANT_A, (tx) => tx.auditLog.findMany({ where: { recordId: created.id } }));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('Égua');
  });
});

describe('retorno do atendimento (RF-ATD-010)', () => {
  it('um retorno ativo por atendimento; cancelar libera para um novo', async () => {
    const appointmentId = randomUUID();
    const first = await service.scheduleVisit(ctxA, visit('2026-11-27T13:00:00Z', { sourceAppointmentId: appointmentId }));

    await expect(
      service.scheduleVisit(ctxA, visit('2026-11-28T13:00:00Z', { sourceAppointmentId: appointmentId })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await service.cancel(ctxA, first.id);
    const second = await service.scheduleVisit(ctxA, visit('2026-11-28T13:00:00Z', { sourceAppointmentId: appointmentId }));

    expect((await service.findReturn(ctxA, appointmentId))?.id).toBe(second.id);
  });

  it('o mesmo atendimento em outro tenant não conflita (o índice inclui o tenant)', async () => {
    const appointmentId = randomUUID();
    await service.scheduleVisit(ctxA, visit('2026-11-27T13:00:00Z', { sourceAppointmentId: appointmentId }));

    await expect(
      service.scheduleVisit(ctxB, visit('2026-11-27T13:00:00Z', { sourceAppointmentId: appointmentId })),
    ).resolves.toBeDefined();
  });
});

describe('transições e edição', () => {
  it('editar só em `scheduled`; excluir some da agenda', async () => {
    const created = await service.scheduleVisit(ctxA, visit('2026-11-20T15:00:00Z'));

    const edited = await service.update(ctxA, created.id, { startsAt: '2026-11-21T15:00:00Z', notes: 'trocar ferradura' });
    expect(edited.startsAt).toBe('2026-11-21T15:00:00.000Z');

    await service.cancel(ctxA, created.id);
    await expect(service.update(ctxA, created.id, { notes: 'x' })).rejects.toMatchObject({ code: 'CONFLICT' });

    await service.remove(ctxA, created.id);
    expect(await service.findById(ctxA, created.id)).toBeNull();
    await expect(service.remove(ctxA, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('o banco recusa visita sem propriedade e lembrete fora do limite, mesmo sem passar pelo service', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.scheduleEvent.create({
          data: { tenantId: TENANT_A, activityType: 'visit', startsAt: NOW, createdBy: randomUUID() },
        }),
      ),
    ).rejects.toThrow(/schedule_events_owner_property_required/);

    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.scheduleEvent.create({
          data: {
            tenantId: TENANT_A,
            activityType: 'other',
            startsAt: NOW,
            createdBy: randomUUID(),
            reminderMinutesBefore: [1, 2, 3, 4],
          },
        }),
      ),
    ).rejects.toThrow(/schedule_events_reminders_range/);
  });
});

describe('última visita por propriedade (base do geofence, RN-008)', () => {
  it('concluir um evento com propriedade conta como visita', async () => {
    const created = await service.scheduleVisit(ctxA, visit('2026-11-10T15:00:00Z'));

    await service.complete(ctxA, created.id);

    const last = await lastVisits.findByProperty(ctxA, PROPERTY_ID);
    expect(last).toMatchObject({ sourceType: 'schedule_event', sourceId: created.id });
    expect(last?.lastVisitAt.toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });

  it('concluído antes do horário marcado conta na hora da conclusão', async () => {
    const created = await service.scheduleVisit(ctxA, visit('2026-11-30T15:00:00Z'));

    await service.complete(ctxA, created.id);

    expect((await lastVisits.findByProperty(ctxA, PROPERTY_ID))?.lastVisitAt.toISOString()).toBe(NOW.toISOString());
  });

  it('só avança: evento antigo chegando depois e redelivery não mudam a data', async () => {
    const newer = appointmentDone(TENANT_A, '2026-11-11T10:00:00.000Z');
    await lastVisitService.handle('appointment.done', newer);
    await lastVisitService.handle('appointment.done', appointmentDone(TENANT_A, '2026-10-01T10:00:00.000Z'));
    await lastVisitService.handle('appointment.done', newer);

    const last = await lastVisits.findByProperty(ctxA, PROPERTY_ID);
    expect(last?.lastVisitAt.toISOString()).toBe('2026-11-11T10:00:00.000Z');
    expect(await admin.propertyLastVisit.count({ where: { tenantId: TENANT_A } })).toBe(1);
  });

  it('a mesma propriedade em outro tenant é outra linha', async () => {
    await lastVisitService.handle('appointment.done', appointmentDone(TENANT_A, '2026-11-11T10:00:00.000Z'));

    expect(await lastVisits.findByProperty(ctxB, PROPERTY_ID)).toBeNull();
  });
});

describe('scheduling_list_reminders_due (SECURITY DEFINER)', () => {
  it('devolve lembretes de todos os tenants na janela, um por antecedência, só de eventos agendados', async () => {
    // Início às 14h: lembretes às 13h (60 min) e às 13h45 (15 min).
    const a = await service.scheduleVisit(ctxA, visit('2026-11-12T14:00:00Z', { reminderMinutesBefore: [60, 15] }));
    const b = await service.scheduleVisit(ctxB, visit('2026-11-12T14:00:00Z', { reminderMinutesBefore: [60] }));
    const cancelled = await service.scheduleVisit(ctxA, visit('2026-11-12T14:00:00Z', { reminderMinutesBefore: [60] }));
    await service.cancel(ctxA, cancelled.id);
    const deleted = await service.scheduleVisit(ctxA, visit('2026-11-12T14:00:00Z', { reminderMinutesBefore: [60] }));
    await service.remove(ctxA, deleted.id);

    const rows = await repo.listRemindersDueAcrossTenants(new Date('2026-11-12T12:50:00Z'), new Date('2026-11-12T13:05:00Z'));
    const ours = rows.filter((r) => [TENANT_A, TENANT_B].includes(r.tenantId));

    expect(ours.map((r) => [r.id, r.minutesBefore]).sort()).toEqual([[a.id, 60], [b.id, 60]].sort());
    expect(ours.find((r) => r.id === a.id)).toMatchObject({ createdBy: ctxA.userId, activityType: 'visit' });
  });

  it('a role da aplicação não lê a tabela de outro tenant direto — só pela função', async () => {
    await service.scheduleVisit(ctxB, visit('2026-11-12T14:00:00Z'));

    const visible = await withTenant(TENANT_A, (tx) => tx.scheduleEvent.count({ where: { tenantId: TENANT_B } }));

    expect(visible).toBe(0);
  });
});
