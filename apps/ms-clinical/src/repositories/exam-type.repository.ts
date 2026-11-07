import type { ExamType as PrismaExamType } from '../../node_modules/.prisma/client-clinical';
import type { RequestContext, UUID, Paginated, ExamType, ExamProtocolField } from '@quironequine/shared-types';
import { withTenant } from '../prisma';
import type { CreateExamTypeInput, UpdateExamTypeInput, ListExamTypesInput } from '../schemas/exam.schema';

/**
 * Catálogo de tipos de exame da clínica — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 */
export class ExamTypeRepository {
  async list(ctx: RequestContext, params: ListExamTypesInput): Promise<Paginated<ExamType>> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null };
      const [rows, total] = await Promise.all([
        tx.examType.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
        tx.examType.count({ where }),
      ]);
      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  /**
   * `includeDeleted`: um pedido em rascunho pode apontar pra um tipo que a
   * clínica excluiu depois — a confirmação da coleta ainda precisa do prazo
   * dele pra calcular a data prevista.
   */
  async findById(ctx: RequestContext, id: UUID, opts: { includeDeleted?: boolean } = {}): Promise<ExamType | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.examType.findFirst({
        where: { id, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
      });
      return row ? toDomain(row) : null;
    });
  }

  async create(ctx: RequestContext, data: CreateExamTypeInput): Promise<ExamType> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.examType.create({
        data: {
          tenantId: ctx.tenantId,
          name: data.name,
          defaultPriceCents: data.defaultPriceCents ?? 0,
          expectedTurnaroundDays: data.expectedTurnaroundDays ?? null,
          protocolFields: (data.protocolFields ?? []) as object[],
        },
      });
      return toDomain(row);
    });
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateExamTypeInput): Promise<ExamType> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.examType.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.defaultPriceCents !== undefined ? { defaultPriceCents: data.defaultPriceCents } : {}),
          ...(data.expectedTurnaroundDays !== undefined
            ? { expectedTurnaroundDays: data.expectedTurnaroundDays }
            : {}),
          ...(data.protocolFields !== undefined ? { protocolFields: data.protocolFields as object[] } : {}),
        },
      });
      return toDomain(row);
    });
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.examType.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}

function toDomain(row: PrismaExamType): ExamType {
  return {
    id: row.id,
    name: row.name,
    defaultPriceCents: row.defaultPriceCents,
    expectedTurnaroundDays: row.expectedTurnaroundDays,
    protocolFields: row.protocolFields as unknown as ExamProtocolField[],
    createdAt: row.createdAt.toISOString(),
  };
}
