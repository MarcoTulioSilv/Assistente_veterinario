import { randomUUID } from 'node:crypto';
import { EVENTS, GEOFENCE_LIMITS } from '@quironequine/shared-types';
import type {
  DomainEvent,
  GeofenceHitResult,
  GeofenceReason,
  GeofenceSettings,
  GeofenceTarget,
  GeofenceTargets,
  GeofenceTriggeredPayload,
  IGeofenceService,
  RequestContext,
  UUID,
} from '@quironequine/shared-types';
import {
  AppError,
  addDays,
  createServiceLogger,
  deriveEventIdempotencyKey,
  saoPauloDay,
  saoPauloDayRange,
} from '@quironequine/shared-middlewares';
import type { GeofenceRepository, PendingReturn, PropertyVisit } from '../repositories/geofence.repository';

const log = createServiceLogger('geofence-service');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ERS §2.6: geofence é do Plano Plus. A rota também usa `requirePlus`
 * (Dev 2), mas a regra mora no service: vale mesmo se uma rota nova esquecer
 * o middleware. Mesma resposta do `requirePlus` (403).
 */
function assertPlus(ctx: RequestContext): void {
  if (ctx.plan !== 'plus') throw AppError.forbidden('Recurso disponível apenas no Plano Plus');
}

/** Mesma chave para a mesma propriedade no mesmo dia: o MS5 não duplica o aviso. */
export function buildGeofenceTriggeredEvent(
  ctx: RequestContext,
  day: string,
  target: GeofenceTarget,
  occurredAt: Date,
): DomainEvent<GeofenceTriggeredPayload> {
  return {
    name: EVENTS.GEOFENCE_TRIGGERED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId || `geofence-${randomUUID()}`,
    idempotencyKey: deriveEventIdempotencyKey(`${EVENTS.GEOFENCE_TRIGGERED}:${day}`, target.propertyId),
    occurredAt: occurredAt.toISOString(),
    payload: {
      propertyId: target.propertyId,
      reasons: target.reasons,
      returnEventIds: target.returnEventIds,
      lastVisitAt: target.lastVisitAt,
      recipientUserId: ctx.userId,
    },
  };
}

/**
 * Lógica de negócio — Dev 1 é o dono. Geofence (RF-AGD-005, RF-NOT-004,
 * RN-008; configuração RF-CFG-005). Decisões de 12/11 e 27/11/2026:
 *
 * - pendência = retorno agendado e não concluído, vencido ou para hoje ou os
 *   próximos 2 dias; OU última visita há mais de X dias (X da clínica,
 *   padrão 90). Propriedade nunca visitada não conta;
 * - a PWA compara a posição no aparelho e só chama `hit` ao entrar no raio;
 *   o servidor confere a pendência de novo e avisa no máximo uma vez por
 *   propriedade por dia, só para quem estava com o aparelho.
 */
export class GeofenceService implements IGeofenceService {
  constructor(
    private readonly repo: GeofenceRepository,
    private readonly publish: (event: DomainEvent<GeofenceTriggeredPayload>) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getSettings(ctx: RequestContext): Promise<GeofenceSettings> {
    assertPlus(ctx);
    return this.repo.getSettings(ctx);
  }

  async updateSettings(ctx: RequestContext, data: Partial<GeofenceSettings>): Promise<GeofenceSettings> {
    assertPlus(ctx);
    const errors: Array<{ field: string; message: string }> = [];
    const { radiusMeters, noVisitDays } = data;
    if (radiusMeters !== undefined && !inRange(radiusMeters, GEOFENCE_LIMITS.minRadiusMeters, GEOFENCE_LIMITS.maxRadiusMeters)) {
      errors.push({
        field: 'radiusMeters',
        message: `Use de ${GEOFENCE_LIMITS.minRadiusMeters} a ${GEOFENCE_LIMITS.maxRadiusMeters} metros`,
      });
    }
    if (noVisitDays !== undefined && !inRange(noVisitDays, GEOFENCE_LIMITS.minNoVisitDays, GEOFENCE_LIMITS.maxNoVisitDays)) {
      errors.push({
        field: 'noVisitDays',
        message: `Use de ${GEOFENCE_LIMITS.minNoVisitDays} a ${GEOFENCE_LIMITS.maxNoVisitDays} dias`,
      });
    }
    if (errors.length > 0) throw AppError.validation('Configuração do geofence inválida', errors);

    return this.repo.upsertSettings(ctx, {
      ...(radiusMeters !== undefined ? { radiusMeters } : {}),
      ...(noVisitDays !== undefined ? { noVisitDays } : {}),
    });
  }

  async targets(ctx: RequestContext): Promise<GeofenceTargets> {
    assertPlus(ctx);
    const settings = await this.repo.getSettings(ctx);
    const targets = await this.findTargets(ctx, settings);
    return { ...settings, targets };
  }

  async hit(ctx: RequestContext, propertyId: UUID): Promise<GeofenceHitResult> {
    assertPlus(ctx);
    const settings = await this.repo.getSettings(ctx);
    const [target] = await this.findTargets(ctx, settings, propertyId);
    if (!target) return { triggered: false, reasons: [] };

    const now = this.now();
    const day = saoPauloDay(now);
    const triggered = await this.repo.recordHit(
      ctx,
      { propertyId, day, userId: ctx.userId, reasons: target.reasons },
      () => this.publish(buildGeofenceTriggeredEvent(ctx, day, target, now)),
    );
    if (triggered) log.info({ reasons: target.reasons, traceId: ctx.traceId }, 'Aviso do geofence publicado');
    return { triggered, reasons: target.reasons };
  }

  /** Pendências por propriedade; com `propertyId`, só dela. */
  private async findTargets(ctx: RequestContext, settings: GeofenceSettings, propertyId?: UUID): Promise<GeofenceTarget[]> {
    const now = this.now();
    const lastReturnDay = addDays(saoPauloDay(now), GEOFENCE_LIMITS.returnLookaheadDays);
    const returnsUntil = saoPauloDayRange(lastReturnDay).to;
    const staleBefore = new Date(now.getTime() - settings.noVisitDays * DAY_MS);

    const [returns, stale] = await Promise.all([
      this.repo.listPendingReturns(ctx, returnsUntil, propertyId),
      this.repo.listStaleVisits(ctx, staleBefore, propertyId),
    ]);

    // Última visita das propriedades que só têm retorno (para a tela mostrar).
    const staleIds = new Set(stale.map((v) => v.propertyId));
    const missing = [...new Set(returns.map((r) => r.propertyId))].filter((id) => !staleIds.has(id));
    const visits = [...stale, ...(await this.repo.listLastVisits(ctx, missing))];

    return mergeTargets(returns, stale, visits);
  }
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Junta retornos e visitas antigas num alvo por propriedade, na ordem em que apareceram. */
function mergeTargets(returns: PendingReturn[], stale: PropertyVisit[], visits: PropertyVisit[]): GeofenceTarget[] {
  const lastVisit = new Map(visits.map((v) => [v.propertyId, v.lastVisitAt.toISOString()]));
  const byProperty = new Map<UUID, GeofenceTarget>();
  const targetFor = (propertyId: UUID): GeofenceTarget => {
    let target = byProperty.get(propertyId);
    if (!target) {
      target = { propertyId, reasons: [], returnEventIds: [], lastVisitAt: lastVisit.get(propertyId) ?? null };
      byProperty.set(propertyId, target);
    }
    return target;
  };

  for (const r of returns) {
    const target = targetFor(r.propertyId);
    if (!target.reasons.includes('return_pending')) target.reasons.push('return_pending');
    target.returnEventIds.push(r.id);
  }
  for (const v of stale) targetFor(v.propertyId).reasons.push('no_recent_visit' satisfies GeofenceReason);

  return [...byProperty.values()];
}
