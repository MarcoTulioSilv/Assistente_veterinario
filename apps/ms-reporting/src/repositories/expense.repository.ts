import type { Expense as PrismaExpense } from '../../node_modules/.prisma/client-reporting';
import type { RequestContext, UUID, Paginated, Expense, ExpenseCategory } from '@quironequine/shared-types';
import { changedFields, writeAudit } from '@quironequine/shared-middlewares';
import { withTenant } from '../prisma';

/** O que o service grava — já validado. `occurredOn` é 'AAAA-MM-DD'. */
export interface ExpenseData {
  occurredOn: string;
  category: ExpenseCategory;
  description: string | null;
  amountCents: number;
  productId: UUID | null;
}

export interface ExpenseFilter {
  page: number;
  limit: number;
  /** 'AAAA-MM-DD', os dois dias incluídos. */
  fromDay?: string;
  toDay?: string;
  category?: ExpenseCategory;
}

const TABLE = 'expenses';

/** 'AAAA-MM-DD' ↔ coluna DATE: meia-noite UTC, para o dia não escorregar com o fuso. */
function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function toDomain(row: PrismaExpense): Expense {
  return {
    id: row.id,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    category: row.category,
    description: row.description,
    amountCents: row.amountCents,
    productId: row.productId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Camada de acesso a dados — Dev 1 é o dono. Saídas de caixa (RF-REL-002) e
 * compras de estoque lançadas à mão. Dado financeiro: toda escrita vai para
 * o audit_log (só os nomes dos campos); soft delete.
 */
export class ExpenseRepository {
  async list(ctx: RequestContext, filter: ExpenseFilter): Promise<Paginated<Expense>> {
    const { page, limit } = filter;
    return withTenant(ctx.tenantId, async (tx) => {
      const where = {
        deletedAt: null,
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.fromDay || filter.toDay
          ? {
              occurredOn: {
                ...(filter.fromDay ? { gte: toDate(filter.fromDay) } : {}),
                ...(filter.toDay ? { lte: toDate(filter.toDay) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.expense.findMany({
          where,
          orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.expense.count({ where }),
      ]);
      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Expense | null> {
    const row = await withTenant(ctx.tenantId, (tx) => tx.expense.findFirst({ where: { id, deletedAt: null } }));
    return row ? toDomain(row) : null;
  }

  async create(ctx: RequestContext, data: ExpenseData): Promise<Expense> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.expense.create({
        data: { ...data, occurredOn: toDate(data.occurredOn), tenantId: ctx.tenantId, createdBy: ctx.userId },
      });
      await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
        action: 'create',
        table: TABLE,
        recordId: row.id,
        fields: changedFields(data),
      });
      return toDomain(row);
    });
  }

  /** `null` se não existe (ou foi excluída). */
  async update(ctx: RequestContext, id: UUID, patch: Partial<ExpenseData>): Promise<Expense | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { occurredOn, ...rest } = patch;
      const { count } = await tx.expense.updateMany({
        where: { id, deletedAt: null },
        data: { ...rest, ...(occurredOn !== undefined ? { occurredOn: toDate(occurredOn) } : {}) },
      });
      if (count === 0) return null;
      await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
        action: 'update',
        table: TABLE,
        recordId: id,
        fields: changedFields(patch),
      });
      return toDomain(await tx.expense.findUniqueOrThrow({ where: { id } }));
    });
  }

  async softDelete(ctx: RequestContext, id: UUID, at: Date): Promise<boolean> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.expense.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: at } });
      if (count === 0) return false;
      await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, { action: 'delete', table: TABLE, recordId: id });
      return true;
    });
  }
}
