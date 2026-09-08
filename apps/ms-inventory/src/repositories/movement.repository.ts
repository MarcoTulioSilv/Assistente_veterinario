import { randomUUID } from 'node:crypto';
import { Prisma } from '../../node_modules/.prisma/client-inventory';
import type { StockMovement as PrismaStockMovement, MovementType, MovementReason } from '../../node_modules/.prisma/client-inventory';
import type { RequestContext, UUID } from '@vetequine/shared-types';
import { withTenant } from '../prisma';

export interface StockMovementRecord {
  id: UUID;
  productId: UUID;
  type: MovementType;
  quantity: number;
  reason: MovementReason;
  referenceId: UUID | null;
  referenceType: string | null;
  notes: string | null;
  createdBy: UUID | null;
  createdAt: string;
}

export interface RecordMovementInput {
  type: MovementType;
  quantity: number;
  reason: MovementReason;
  notes?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  createdBy?: string | null;
  /** Omitido em lançamentos manuais (não precisam de idempotência); obrigatório em baixas via broker. */
  idempotencyKey?: UUID;
}

// P2002 é suficiente: StockMovement só tem UM campo @unique (idempotencyKey).
// `err.meta.target` não é confiável pra identificar a constraint em todos os
// drivers/engines do Prisma (varia entre "(not available)" e a lista real).
function isUniqueIdempotencyKeyError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * StockMovement é ledger imutável (RF-EST-007): só INSERT, nunca
 * UPDATE/DELETE, nem soft delete.
 */
export class MovementRepository {
  async list(
    ctx: RequestContext,
    productId: UUID,
    params: { page: number; limit: number },
  ): Promise<{ data: StockMovementRecord[]; total: number }> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { productId };
      const [rows, total] = await Promise.all([
        tx.stockMovement.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
        tx.stockMovement.count({ where }),
      ]);
      return { data: rows.map(toDomain), total };
    });
  }

  /**
   * Registra o movimento e ajusta `quantityInStock` do produto,
   * atomicamente. Idempotente via `idempotency_key` UNIQUE (ADR-001 §5.4):
   * se a chave já foi usada, retorna o movimento existente sem baixar
   * o estoque de novo — em vez de checar-e-então-inserir (que teria uma
   * janela de corrida), deixa o banco rejeitar o INSERT duplicado.
   */
  async record(ctx: RequestContext, productId: UUID, input: RecordMovementInput): Promise<StockMovementRecord> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    try {
      return await withTenant(ctx.tenantId, async (tx) => {
        const row = await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            productId,
            type: input.type,
            quantity: input.quantity,
            reason: input.reason,
            referenceId: input.referenceId ?? null,
            referenceType: input.referenceType ?? null,
            idempotencyKey,
            notes: input.notes ?? null,
            createdBy: input.createdBy ?? null,
          },
        });

        await tx.product.update({
          where: { id: productId },
          data: {
            quantityInStock:
              input.type === 'in' ? { increment: input.quantity } : { decrement: input.quantity },
          },
        });

        return toDomain(row);
      });
    } catch (err) {
      if (isUniqueIdempotencyKeyError(err)) {
        const existing = await withTenant(ctx.tenantId, (tx) =>
          tx.stockMovement.findUniqueOrThrow({ where: { idempotencyKey } }),
        );
        return toDomain(existing);
      }
      throw err;
    }
  }
}

function toDomain(row: PrismaStockMovement): StockMovementRecord {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type,
    quantity: row.quantity.toNumber(),
    reason: row.reason,
    referenceId: row.referenceId,
    referenceType: row.referenceType,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
