import { Prisma } from '../../node_modules/.prisma/client-scheduling';
import type { ScheduleEvent as PrismaScheduleEvent } from '../../node_modules/.prisma/client-scheduling';
import type {
  RequestContext,
  UUID,
  ScheduleEvent,
  ScheduleActivityType,
  ScheduleEventStatus,
} from '@quironequine/shared-types';
import { AppError, writeAudit, type AuditActor } from '@quironequine/shared-middlewares';
import { prisma, withTenant } from '../prisma';
import { upsertLastVisit } from './last-visit.repository';

/** O que o service grava — já validado e normalizado (datas como Date). */
export interface ScheduleEventData {
  activityType: ScheduleActivityType;
  startsAt: Date;
  endsAt: Date | null;
  ownerId: UUID | null;
  propertyId: UUID | null;
  animalIds: UUID[];
  notes: string | null;
  reminderMinutesBefore: number[];
  sourceAppointmentId: UUID | null;
}

/** Edição: tipo e origem não mudam (um retorno continua retorno). */
export type ScheduleEventPatch = Partial<Omit<ScheduleEventData, 'activityType' | 'sourceAppointmentId'>>;

/** Linha da varredura de lembretes (função SECURITY DEFINER). */
export interface ReminderDueRow {
  id: UUID;
  tenantId: UUID;
  activityType: ScheduleActivityType;
  startsAt: Date;
  minutesBefore: number;
  ownerId: UUID | null;
  propertyId: UUID | null;
  createdBy: UUID;
}

interface ReminderDueSqlRow {
  id: string;
  tenant_id: string;
  activity_type: ScheduleActivityType;
  starts_at: Date;
  minutes_before: number;
  owner_id: string | null;
  property_id: string | null;
  created_by: string;
}

const TABLE = 'schedule_events';

function actor(ctx: RequestContext): AuditActor {
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

/** Só o índice único parcial do retorno gera P2002 nesta tabela. */
function isUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const RETURN_CONFLICT = 'Este atendimento já tem um retorno agendado';

export function toDomain(row: PrismaScheduleEvent): ScheduleEvent {
  return {
    id: row.id,
    activityType: row.activityType,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    animalIds: row.animalIds,
    notes: row.notes,
    reminderMinutesBefore: row.reminderMinutesBefore,
    sourceAppointmentId: row.sourceAppointmentId,
    createdBy: row.createdBy,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Campos enviados, para o audit_log — só os nomes, nunca os valores (M-06). */
function sentFields(data: object): string[] {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2). Soft delete:
 * nada é apagado de verdade (LGPD); a role da aplicação nem tem DELETE.
 */
export class ScheduleEventRepository {
  async findById(ctx: RequestContext, id: UUID): Promise<ScheduleEvent | null> {
    const row = await withTenant(ctx.tenantId, (tx) => tx.scheduleEvent.findFirst({ where: { id, deletedAt: null } }));
    return row ? toDomain(row) : null;
  }

  /** Retorno ativo (não cancelado nem excluído) de um atendimento. */
  async findActiveReturn(ctx: RequestContext, appointmentId: UUID): Promise<ScheduleEvent | null> {
    const row = await withTenant(ctx.tenantId, (tx) =>
      tx.scheduleEvent.findFirst({
        where: { sourceAppointmentId: appointmentId, deletedAt: null, status: { not: 'cancelled' } },
      }),
    );
    return row ? toDomain(row) : null;
  }

  /** Eventos com início em [from, to), em ordem cronológica. */
  async listRange(
    ctx: RequestContext,
    from: Date,
    to: Date,
    status?: ScheduleEventStatus | ScheduleEventStatus[],
  ): Promise<ScheduleEvent[]> {
    const statusFilter = status === undefined ? {} : { status: Array.isArray(status) ? { in: status } : status };
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.scheduleEvent.findMany({
        where: { startsAt: { gte: from, lt: to }, deletedAt: null, ...statusFilter },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return rows.map(toDomain);
  }

  /** CONFLICT se o atendimento de origem já tem retorno ativo (índice único parcial). */
  async create(ctx: RequestContext, data: ScheduleEventData): Promise<ScheduleEvent> {
    try {
      const row = await withTenant(ctx.tenantId, async (tx) => {
        const created = await tx.scheduleEvent.create({
          data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId },
        });
        await writeAudit(tx, actor(ctx), {
          action: 'create',
          table: TABLE,
          recordId: created.id,
          fields: sentFields(data),
        });
        return created;
      });
      return toDomain(row);
    } catch (err) {
      if (isUniqueError(err)) throw AppError.conflict(RETURN_CONFLICT);
      throw err;
    }
  }

  /** Só em `scheduled`; devolve null se o evento não existe ou já saiu de `scheduled`. */
  async update(ctx: RequestContext, id: UUID, patch: ScheduleEventPatch): Promise<ScheduleEvent | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.scheduleEvent.updateMany({
        where: { id, status: 'scheduled', deletedAt: null },
        data: patch,
      });
      if (count === 0) return null;
      await writeAudit(tx, actor(ctx), { action: 'update', table: TABLE, recordId: id, fields: sentFields(patch) });
      const row = await tx.scheduleEvent.findUniqueOrThrow({ where: { id } });
      return toDomain(row);
    });
  }

  /**
   * `scheduled → done`. Com propriedade, a conclusão conta como visita a ela
   * (geofence, RN-008) — na mesma transação.
   */
  async complete(ctx: RequestContext, id: UUID, at: Date): Promise<ScheduleEvent | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.scheduleEvent.updateMany({
        where: { id, status: 'scheduled', deletedAt: null },
        data: { status: 'done', completedAt: at },
      });
      if (count === 0) return null;
      const row = await tx.scheduleEvent.findUniqueOrThrow({ where: { id } });
      if (row.propertyId) {
        await upsertLastVisit(tx, ctx.tenantId, {
          propertyId: row.propertyId,
          // A visita foi no horário marcado — ou agora, se foi concluída antes dele.
          visitedAt: row.startsAt < at ? row.startsAt : at,
          sourceType: 'schedule_event',
          sourceId: row.id,
        });
      }
      await writeAudit(tx, actor(ctx), { action: 'finish', table: TABLE, recordId: id, fields: ['status'] });
      return toDomain(row);
    });
  }

  /** `scheduled → cancelled`. */
  async cancel(ctx: RequestContext, id: UUID, at: Date): Promise<ScheduleEvent | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.scheduleEvent.updateMany({
        where: { id, status: 'scheduled', deletedAt: null },
        data: { status: 'cancelled', cancelledAt: at },
      });
      if (count === 0) return null;
      await writeAudit(tx, actor(ctx), { action: 'cancel', table: TABLE, recordId: id, fields: ['status'] });
      const row = await tx.scheduleEvent.findUniqueOrThrow({ where: { id } });
      return toDomain(row);
    });
  }

  /** Soft delete. Devolve false se não havia o que excluir. */
  async softDelete(ctx: RequestContext, id: UUID, at: Date): Promise<boolean> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.scheduleEvent.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: at },
      });
      if (count === 0) return false;
      await writeAudit(tx, actor(ctx), { action: 'delete', table: TABLE, recordId: id });
      return true;
    });
  }

  /**
   * Lembretes cujo instante (início − antecedência) cai em [from, to), de
   * todos os tenants — pela função SECURITY DEFINER, nunca contornando o RLS
   * (ADR-006).
   */
  async listRemindersDueAcrossTenants(from: Date, to: Date): Promise<ReminderDueRow[]> {
    const rows = await prisma.$queryRaw<ReminderDueSqlRow[]>`
      SELECT * FROM scheduling_list_reminders_due(${from}::timestamptz, ${to}::timestamptz)
    `;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      activityType: row.activity_type,
      startsAt: row.starts_at,
      minutesBefore: row.minutes_before,
      ownerId: row.owner_id,
      propertyId: row.property_id,
      createdBy: row.created_by,
    }));
  }
}
