import type { RequestContext, UUID } from '@quironequine/shared-types';
import { withTenant } from '../prisma';

export type VisitSource = 'appointment' | 'vaccination' | 'schedule_event';

export interface VisitData {
  propertyId: UUID;
  visitedAt: Date;
  sourceType: VisitSource;
  sourceId: UUID;
}

export interface LastVisit {
  propertyId: UUID;
  lastVisitAt: Date;
  sourceType: VisitSource;
  sourceId: UUID;
}

/** O mínimo de uma transação do Prisma que o upsert usa. */
interface RawTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/**
 * Registra uma visita à propriedade, guardando só a MAIS RECENTE.
 *
 * O `WHERE` do `ON CONFLICT` faz o trabalho de idempotência e de ordem:
 * redelivery do mesmo evento não muda nada, e um evento antigo que chegue
 * depois de um novo (retry do broker) não volta a data. Sem tabela de chaves
 * processadas — o resultado é o mesmo em qualquer ordem e quantidade.
 *
 * Roda dentro de um withTenant (o RLS confere o tenant_id no INSERT).
 * Sem audit_log: é dado operacional derivado (data e origem), sem dado
 * pessoal; a escrita de origem já foi auditada no MS3 ou na agenda.
 */
export async function upsertLastVisit(tx: RawTx, tenantId: UUID, visit: VisitData): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO property_last_visits
      (id, tenant_id, property_id, last_visit_at, source_type, source_id, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${tenantId}::uuid, ${visit.propertyId}::uuid, ${visit.visitedAt}::timestamptz,
       ${visit.sourceType}::"VisitSourceType", ${visit.sourceId}::uuid, now(), now())
    ON CONFLICT (tenant_id, property_id) DO UPDATE
      SET last_visit_at = EXCLUDED.last_visit_at,
          source_type = EXCLUDED.source_type,
          source_id = EXCLUDED.source_id,
          updated_at = now()
      WHERE property_last_visits.last_visit_at < EXCLUDED.last_visit_at
  `;
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Última visita por propriedade
 * (geofence da Sprint 11, RN-008).
 */
export class LastVisitRepository {
  async record(ctx: RequestContext, visit: VisitData): Promise<void> {
    await withTenant(ctx.tenantId, (tx) => upsertLastVisit(tx, ctx.tenantId, visit));
  }

  async findByProperty(ctx: RequestContext, propertyId: UUID): Promise<LastVisit | null> {
    const row = await withTenant(ctx.tenantId, (tx) =>
      tx.propertyLastVisit.findUnique({ where: { tenantId_propertyId: { tenantId: ctx.tenantId, propertyId } } }),
    );
    return row
      ? { propertyId: row.propertyId, lastVisitAt: row.lastVisitAt, sourceType: row.sourceType, sourceId: row.sourceId }
      : null;
  }
}
