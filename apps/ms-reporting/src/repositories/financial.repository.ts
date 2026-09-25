import { Prisma } from '../../node_modules/.prisma/client-reporting';
import type { FinancialRecord as PrismaFinancialRecord } from '../../node_modules/.prisma/client-reporting';
import type {
  RequestContext,
  UUID,
  Paginated,
  FinancialRecord,
  FinancialSourceType,
  CreateFinancialRecordDto,
} from '@quironequine/shared-types';
import { withTenant } from '../prisma';
import type { ListFinancialRecordsInput } from '../schemas/financial.schema';

// P2002 é suficiente: FinancialRecord só tem UM campo @unique
// (idempotencyKey). `err.meta.target` não é confiável pra identificar a
// constraint em todos os drivers/engines do Prisma.
function isUniqueIdempotencyKeyError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 */
export class FinancialRepository {
  async list(
    ctx: RequestContext,
    params: ListFinancialRecordsInput,
  ): Promise<Paginated<FinancialRecord>> {
    return this.paginate(ctx, params, {});
  }

  /** RF-ATD-008: pendências na aba do proprietário. */
  async listByOwner(
    ctx: RequestContext,
    ownerId: UUID,
    params: ListFinancialRecordsInput,
  ): Promise<Paginated<FinancialRecord>> {
    return this.paginate(ctx, params, { ownerId });
  }

  private async paginate(
    ctx: RequestContext,
    params: ListFinancialRecordsInput,
    filter: Record<string, unknown>,
  ): Promise<Paginated<FinancialRecord>> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null, ...(status ? { status } : {}), ...filter };

      const [rows, total] = await Promise.all([
        tx.financialRecord.findMany({ where, skip, take: limit, orderBy: { occurredAt: 'desc' } }),
        tx.financialRecord.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<FinancialRecord | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.financialRecord.findFirst({ where: { id, deletedAt: null } });
      return row ? toDomain(row) : null;
    });
  }

  /** Um atendimento/exame/vacinação tem no máximo uma pendência. */
  async findBySource(
    ctx: RequestContext,
    sourceType: FinancialSourceType,
    sourceId: UUID,
  ): Promise<FinancialRecord | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.financialRecord.findFirst({
        where: { sourceType, sourceId, deletedAt: null },
      });
      return row ? toDomain(row) : null;
    });
  }

  /**
   * Idempotente via `idempotency_key` UNIQUE (ADR-001 §5.4): a pendência
   * nasce de evento do broker, e redelivery não pode cobrar duas vezes do
   * proprietário. Se a chave já foi usada, devolve o que já existe em vez
   * de estourar — o mesmo tratamento que o MovementRepository do MS2 dá à
   * baixa de estoque.
   */
  async recordPending(
    ctx: RequestContext,
    data: CreateFinancialRecordDto,
    idempotencyKey: UUID,
  ): Promise<FinancialRecord> {
    try {
      return await withTenant(ctx.tenantId, async (tx) => {
        const row = await tx.financialRecord.create({
          data: {
            tenantId: ctx.tenantId,
            ownerId: data.ownerId,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            amountCents: data.amountCents,
            occurredAt: new Date(data.occurredAt),
            idempotencyKey,
          },
        });
        return toDomain(row);
      });
    } catch (err) {
      if (!isUniqueIdempotencyKeyError(err)) throw err;

      // A busca precisa de uma transação NOVA: no Postgres, o INSERT que
      // violou a UNIQUE aborta a transação inteira, e qualquer comando
      // seguinte dentro dela falha com 25P02. Mesmo padrão do
      // MovementRepository do MS2.
      const existing = await withTenant(ctx.tenantId, (tx) =>
        tx.financialRecord.findUniqueOrThrow({ where: { idempotencyKey } }),
      );
      return toDomain(existing);
    }
  }

  /**
   * RN-002: só sai de `pending` com registro explícito de pagamento.
   * O UPDATE é condicionado ao status pra que duas chamadas concorrentes
   * não gerem dois eventos `payment.registered`.
   */
  async markReceived(ctx: RequestContext, id: UUID, paidAt: Date): Promise<FinancialRecord | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.financialRecord.updateMany({
        where: { id, status: 'pending', deletedAt: null },
        data: { status: 'received', paidAt },
      });

      if (count === 0) return null;

      const row = await tx.financialRecord.findFirstOrThrow({ where: { id } });
      return toDomain(row);
    });
  }
}

function toDomain(row: PrismaFinancialRecord): FinancialRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    amountCents: row.amountCents,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
