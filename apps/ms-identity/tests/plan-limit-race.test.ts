/**
 * ══════════════════════════════════════════════════════════════════
 * Limite do Plano Básico sob concorrência (auditoria 06/11/2026, B-01)
 *
 * POR QUE ESTE TESTE EXISTE: antes, a contagem e a gravação ficavam em
 * transações separadas, e cadastros simultâneos passavam do limite de 30.
 * Só o Postgres real prova que a trava (pg_advisory_xact_lock) serializa
 * os cadastros da mesma clínica. Roda como quironequine_app.
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@quironequine/shared-types';
import { OwnerRepository } from '../src/repositories/owner.repository';
import { PropertyRepository } from '../src/repositories/property.repository';
import { OwnerService } from '../src/services/owner.service';
import { PropertyService } from '../src/services/property.service';
import { PlanService } from '../src/services/plan.service';
import type { GeoService } from '../src/services/geo.service';
import { prisma as appPrisma } from '../src/prisma';

const TENANT_ID = 'b10c0000-0000-4000-8000-000000000020';
const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'b10c0000-0000-4000-8000-0000000000dd',
  role: 'admin',
  plan: 'basic',
  traceId: 'b01',
};

const noGeo = { resolveCoordinates: async () => null } as unknown as GeoService;

async function cleanup(): Promise<void> {
  await admin.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.tenant.deleteMany({ where: { id: TENANT_ID } }); // cascata
}

describe('limite do Plano Básico sem corrida (B-01)', () => {
  beforeAll(async () => {
    await cleanup();
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica B-01', slug: 'plan-limit-race-test', plan: 'basic', status: 'active' },
    });
    await admin.owner.createMany({
      data: Array.from({ length: 29 }, (_, i) => ({ tenantId: TENANT_ID, fullName: `Proprietário ${i + 1}` })),
    });
    await admin.property.createMany({
      data: Array.from({ length: 29 }, (_, i) => ({ tenantId: TENANT_ID, name: `Fazenda ${i + 1}` })),
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('cinco proprietários ao mesmo tempo com 29 cadastrados: entra um, o total para em 30', async () => {
    const service = new OwnerService(new OwnerRepository(), new PlanService());

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => service.create(ctx, { fullName: `Concorrente ${i + 1}` })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => (r.reason as { code?: string }).code === 'PLAN_LIMIT_REACHED')).toBe(true);
    expect(await admin.owner.count({ where: { tenantId: TENANT_ID, deletedAt: null } })).toBe(30);
  });

  it('o mesmo para propriedades', async () => {
    const service = new PropertyService(new PropertyRepository(), noGeo, new PlanService());

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => service.create(ctx, { name: `Fazenda concorrente ${i + 1}` })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await admin.property.count({ where: { tenantId: TENANT_ID, deletedAt: null } })).toBe(30);
  });
});
