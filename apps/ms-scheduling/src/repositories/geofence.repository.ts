import { GEOFENCE_DEFAULTS } from '@quironequine/shared-types';
import type { RequestContext, UUID, GeofenceSettings, GeofenceReason } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

/** Retorno agendado que conta como pendência. */
export interface PendingReturn {
  id: UUID;
  propertyId: UUID;
  startsAt: Date;
}

export interface PropertyVisit {
  propertyId: UUID;
  lastVisitAt: Date;
}

export interface GeofenceHitData {
  propertyId: UUID;
  /** 'AAAA-MM-DD' de São Paulo. */
  day: string;
  userId: UUID;
  reasons: GeofenceReason[];
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Geofence (Sprint 11 do M3,
 * RF-AGD-005, RN-008): configuração da clínica, pendências por propriedade e
 * o registro de "já avisou hoje".
 *
 * Sem audit_log: configuração e aviso não têm dado pessoal de cliente; a
 * posição do aparelho nunca chega aqui.
 */
export class GeofenceRepository {
  async getSettings(ctx: RequestContext): Promise<GeofenceSettings> {
    const row = await withTenant(ctx.tenantId, (tx) =>
      tx.geofenceSettings.findUnique({ where: { tenantId: ctx.tenantId } }),
    );
    return row ? { radiusMeters: row.radiusMeters, noVisitDays: row.noVisitDays } : GEOFENCE_DEFAULTS;
  }

  /** Campo ausente mantém o valor atual (ou o padrão, na primeira gravação). */
  async upsertSettings(ctx: RequestContext, data: Partial<GeofenceSettings>): Promise<GeofenceSettings> {
    return withTenant(ctx.tenantId, async (tx) => {
      const current = await tx.geofenceSettings.findUnique({ where: { tenantId: ctx.tenantId } });
      const next: GeofenceSettings = {
        radiusMeters: data.radiusMeters ?? current?.radiusMeters ?? GEOFENCE_DEFAULTS.radiusMeters,
        noVisitDays: data.noVisitDays ?? current?.noVisitDays ?? GEOFENCE_DEFAULTS.noVisitDays,
      };
      await tx.geofenceSettings.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, ...next },
        update: next,
      });
      return next;
    });
  }

  /**
   * Retornos ainda agendados (não concluídos, cancelados nem excluídos) com
   * início antes de `until`, em ordem de data. Retorno é sempre uma visita
   * com propriedade (CHECKs da agenda).
   */
  async listPendingReturns(ctx: RequestContext, until: Date, propertyId?: UUID): Promise<PendingReturn[]> {
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.scheduleEvent.findMany({
        where: {
          sourceAppointmentId: { not: null },
          propertyId: propertyId ?? { not: null },
          status: 'scheduled',
          deletedAt: null,
          startsAt: { lt: until },
        },
        select: { id: true, propertyId: true, startsAt: true },
        orderBy: { startsAt: 'asc' },
      }),
    );
    return rows.flatMap((r) => (r.propertyId ? [{ id: r.id, propertyId: r.propertyId, startsAt: r.startsAt }] : []));
  }

  /** Última visita das propriedades pedidas. */
  async listLastVisits(ctx: RequestContext, propertyIds: UUID[]): Promise<PropertyVisit[]> {
    if (propertyIds.length === 0) return [];
    return withTenant(ctx.tenantId, (tx) =>
      tx.propertyLastVisit.findMany({
        where: { propertyId: { in: propertyIds } },
        select: { propertyId: true, lastVisitAt: true },
      }),
    );
  }

  /** Propriedades cuja última visita foi antes de `before`. Nunca visitada não aparece (decisão de 27/11). */
  async listStaleVisits(ctx: RequestContext, before: Date, propertyId?: UUID): Promise<PropertyVisit[]> {
    return withTenant(ctx.tenantId, (tx) =>
      tx.propertyLastVisit.findMany({
        where: { lastVisitAt: { lt: before }, ...(propertyId ? { propertyId } : {}) },
        select: { propertyId: true, lastVisitAt: true },
        orderBy: { lastVisitAt: 'asc' },
      }),
    );
  }

  /**
   * Grava o aviso do dia e, só se ele for NOVO, chama `publish` — na mesma
   * transação. Se a publicação falhar, o registro volta junto e o aparelho
   * pode tentar de novo; se o commit falhar depois de publicar, a chave
   * derivada do evento evita aviso duplicado no MS5. Devolve se publicou.
   */
  async recordHit(ctx: RequestContext, hit: GeofenceHitData, publish: () => Promise<void>): Promise<boolean> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.geofenceHit.createMany({
        data: [
          {
            tenantId: ctx.tenantId,
            propertyId: hit.propertyId,
            day: new Date(`${hit.day}T00:00:00Z`),
            userId: hit.userId,
            reasons: hit.reasons,
          },
        ],
        skipDuplicates: true, // ON CONFLICT DO NOTHING na UNIQUE (tenant, propriedade, dia)
      });
      if (count === 0) return false;
      await publish();
      return true;
    });
  }
}
