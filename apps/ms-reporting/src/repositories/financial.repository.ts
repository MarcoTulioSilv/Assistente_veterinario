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

// FinancialRecord tem duas UNIQUEs (idempotency_key e a origem), e o
// tratamento é o mesmo pras duas — buscar o registro da origem. Por isso não
// importa qual disparou, o que é bom: `err.meta.target` não é confiável pra
// identificar a constraint em todos os drivers/engines do Prisma.
function isUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Desfecho do cancelamento — o service registra em log; os testes conferem. */
export type CancelOutcome = 'cancelled' | 'kept-received' | 'already-cancelled' | 'cancelled-before-pending';

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
      if (!isUniqueError(err)) throw err;

      // Duas UNIQUEs podem ter disparado, e as duas significam "essa origem
      // já tem registro": a idempotency_key (reentrega do mesmo evento) ou a
      // (source_type, source_id) (a exclusão chegou antes e deixou a origem
      // marcada como cancelada). Nos dois casos o registro existente vence —
      // inclusive o cancelado, que assim não ressuscita como pendente.
      //
      // A busca precisa de uma transação NOVA: no Postgres, o INSERT que
      // violou a UNIQUE aborta a transação inteira, e qualquer comando
      // seguinte dentro dela falha com 25P02. Mesmo padrão do
      // MovementRepository do MS2.
      const existing = await this.findRowBySource(ctx, data.sourceType, data.sourceId);
      if (!existing) throw err;
      return toDomain(existing);
    }
  }

  /**
   * Cancela a pendência da origem quando o atendimento é excluído. Três
   * desfechos, e nenhum depende da ordem em que os eventos chegaram:
   *
   *  - havia pendência `pending` → vira `cancelled`;
   *  - havia registro `received` → fica como está (dinheiro recebido não se
   *    apaga) e o desfecho avisa quem chamou; já `cancelled` → nada a fazer;
   *  - não havia registro nenhum → a exclusão chegou ANTES do
   *    `appointment.done` (retry do broker). Grava a origem já cancelada;
   *    quando a pendência tentar nascer, esbarra na UNIQUE da origem.
   */
  async cancelBySource(
    ctx: RequestContext,
    data: CreateFinancialRecordDto,
    idempotencyKey: UUID,
  ): Promise<CancelOutcome> {
    const first = await this.cancelExisting(ctx, data);
    if (first) return first;

    try {
      await withTenant(ctx.tenantId, (tx) =>
        tx.financialRecord.create({
          data: {
            tenantId: ctx.tenantId,
            ownerId: data.ownerId,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            amountCents: data.amountCents,
            occurredAt: new Date(data.occurredAt),
            status: 'cancelled',
            cancelledAt: new Date(),
            idempotencyKey,
          },
        }),
      );
      return 'cancelled-before-pending';
    } catch (err) {
      if (!isUniqueError(err)) throw err;

      // Corrida: a pendência nasceu entre a checagem e o INSERT (ou é
      // reentrega desta mesma exclusão). Agora o registro existe — basta
      // repetir a checagem, numa transação nova (o INSERT abortou a anterior).
      const retry = await this.cancelExisting(ctx, data);
      if (retry) return retry;
      throw err;
    }
  }

  private async cancelExisting(
    ctx: RequestContext,
    data: CreateFinancialRecordDto,
  ): Promise<CancelOutcome | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.financialRecord.updateMany({
        where: { sourceType: data.sourceType, sourceId: data.sourceId, status: 'pending' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      if (count > 0) return 'cancelled';

      const existing = await tx.financialRecord.findUnique({
        where: { sourceType_sourceId: { sourceType: data.sourceType, sourceId: data.sourceId } },
      });
      if (!existing) return null;
      return existing.status === 'received' ? 'kept-received' : 'already-cancelled';
    });
  }

  private async findRowBySource(
    ctx: RequestContext,
    sourceType: FinancialSourceType,
    sourceId: UUID,
  ): Promise<PrismaFinancialRecord | null> {
    return withTenant(ctx.tenantId, (tx) =>
      tx.financialRecord.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } }),
    );
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
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
