import type { IStockService, RequestContext, UUID, Paginated, Product } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';
import type { ProductRepository } from '../repositories/product.repository';
import type { MovementRepository, StockMovementRecord } from '../repositories/movement.repository';
import type { CreateProductInput, UpdateProductInput, ListProductsInput } from '../schemas/product.schema';
import type { CreateMovementInput, ListMovementsInput } from '../schemas/movement.schema';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IStockService publicada em shared-types.
 * Dev 2 pode usar MockStockService com a mesma interface enquanto isto não existe.
 */
export class StockService implements IStockService {
  constructor(
    private readonly products: ProductRepository,
    private readonly movements: MovementRepository,
  ) {}

  async list(ctx: RequestContext, params: ListProductsInput): Promise<Paginated<Product>> {
    return this.products.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Product | null> {
    return this.products.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreateProductInput): Promise<Product> {
    return this.products.create(ctx, data);
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateProductInput): Promise<Product> {
    const existing = await this.products.findById(ctx, id);
    if (!existing) throw AppError.notFound('Produto não encontrado');
    return this.products.update(ctx, id, data);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.products.findById(ctx, id);
    if (!existing) throw AppError.notFound('Produto não encontrado');
    await this.products.softDelete(ctx, id);
  }

  /** RN-003: baixa idempotente disparada por evento do broker (appointment.done) */
  async deduct(
    ctx: RequestContext,
    productId: UUID,
    qty: number,
    idempotencyKey: UUID,
    reference?: { referenceId: UUID; referenceType: string },
  ): Promise<void> {
    const existing = await this.products.findById(ctx, productId);
    if (!existing) throw AppError.notFound('Produto não encontrado');

    await this.movements.record(ctx, productId, {
      type: 'out',
      quantity: qty,
      reason: 'appointment',
      idempotencyKey,
      referenceId: reference?.referenceId ?? null,
      referenceType: reference?.referenceType ?? null,
    });
  }

  /** RF-EST-007: lançamento manual de movimentação — não faz parte do contrato publicado. */
  async recordMovement(ctx: RequestContext, productId: UUID, data: CreateMovementInput): Promise<StockMovementRecord> {
    const existing = await this.products.findById(ctx, productId);
    if (!existing) throw AppError.notFound('Produto não encontrado');

    return this.movements.record(ctx, productId, {
      type: data.type,
      quantity: data.quantity,
      reason: data.reason,
      notes: data.notes ?? null,
    });
  }

  async listMovements(
    ctx: RequestContext,
    productId: UUID,
    params: ListMovementsInput,
  ): Promise<{ data: StockMovementRecord[]; total: number }> {
    return this.movements.list(ctx, productId, params);
  }
}
