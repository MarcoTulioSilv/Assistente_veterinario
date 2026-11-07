import type { IStockService, RequestContext, UUID, Paginated, Product, StockConsumptionSource } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ProductRepository } from '../repositories/product.repository';
import type { MovementRepository, StockMovementRecord } from '../repositories/movement.repository';
import {
  unitAllowedForCategory,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsInput,
} from '../schemas/product.schema';
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
    requireVaccineForInterval(data.category, data.doseIntervalDays);
    requireValidMl({
      category: data.category,
      unit: data.unit,
      mlPerUnit: data.mlPerUnit ?? null,
      applicationMl: data.applicationMl ?? null,
    });
    return this.products.create(ctx, data);
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateProductInput): Promise<Product> {
    const existing = await this.products.findById(ctx, id);
    if (!existing) throw AppError.notFound('Produto não encontrado');

    const category = data.category ?? existing.category;
    // Produto que deixa de ser vacina perde o intervalo e o volume de
    // aplicação junto — senão ficaria um valor órfão que o PATCH seguinte
    // rejeitaria sem motivo aparente.
    const changes = { ...data };
    if (category !== 'vaccine') {
      if (data.doseIntervalDays === undefined && existing.doseIntervalDays !== null) changes.doseIntervalDays = null;
      if (data.applicationMl === undefined && existing.applicationMl !== null) changes.applicationMl = null;
    }
    requireVaccineForInterval(category, changes.doseIntervalDays);

    // Num PATCH parcial, as regras que cruzam campos valem para o produto
    // como vai FICAR: trocar só a categoria também confere a unidade e o ml
    // que já estavam gravados.
    const unit = data.unit ?? existing.unit;
    if (!unitAllowedForCategory(category, unit)) {
      throw AppError.validation('Unidade incompatível com a categoria', [
        { field: 'unit', message: `Unidade "${unit}" não é válida para a categoria "${category}"` },
      ]);
    }
    requireValidMl({
      category,
      unit,
      mlPerUnit: changes.mlPerUnit !== undefined ? changes.mlPerUnit : existing.mlPerUnit,
      applicationMl: changes.applicationMl !== undefined ? changes.applicationMl : existing.applicationMl,
    });

    return this.products.update(ctx, id, changes);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.products.findById(ctx, id);
    if (!existing) throw AppError.notFound('Produto não encontrado');
    await this.products.softDelete(ctx, id);
  }

  /**
   * RN-003: baixa idempotente disparada por evento do broker
   * (appointment.done, exam.collected, vaccination.applied). `qty` vem em ml
   * nos produtos usados por ml e sai na unidade de estoque (toStockUnits). O
   * motivo do movimento sai do tipo da origem — sem referência, é
   * atendimento (contrato antigo).
   */
  async deduct(
    ctx: RequestContext,
    productId: UUID,
    qty: number,
    idempotencyKey: UUID,
    reference?: { referenceId: UUID; referenceType: StockConsumptionSource },
  ): Promise<void> {
    const existing = await this.products.findById(ctx, productId);
    if (!existing) throw AppError.notFound('Produto não encontrado');
    // A vacinação manda ml. Vacina gravada antes da troca para ml (sem
    // `mlPerUnit`) baixaria ml como se fossem frascos — falha à vista, para
    // alguém completar o cadastro, em vez de errar o estoque calada.
    if (reference?.referenceType === 'vaccination' && existing.unit !== 'ml' && existing.mlPerUnit === null) {
      throw AppError.validation(`Vacina "${existing.name}" sem ml por unidade cadastrado — baixa não feita`);
    }

    await this.movements.record(ctx, productId, {
      type: 'out',
      quantity: toStockUnits(qty, existing.mlPerUnit),
      reason: reference?.referenceType ?? 'appointment',
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

/**
 * Ml → unidade de estoque: 25 ml de um frasco de 50 baixam meio frasco. Sem
 * conversão, a quantidade já está na unidade de estoque. Arredonda em 3
 * casas, a precisão da coluna de quantidade — e nunca deixa um uso real
 * virar baixa zero.
 */
export function toStockUnits(quantity: number, mlPerUnit: number | null): number {
  const units = Math.round((quantity / (mlPerUnit ?? 1)) * 1000) / 1000;
  return Math.max(units, 0.001);
}

function invalid(field: string, message: string): AppError {
  return AppError.validation(message, [{ field, message }]);
}

/**
 * Reunião de 2026-11-03: medicamento e vacina são cobrados por ml.
 * - ml por unidade: só medicamento e vacina, e nunca em produto comprado em ml;
 * - vacina precisa ser usável por ml (comprada em ml ou com `mlPerUnit`):
 *   a vacinação registra ml por animal;
 * - volume de aplicação: só vacina.
 */
function requireValidMl(p: {
  category: Product['category'];
  unit: Product['unit'];
  mlPerUnit: number | null;
  applicationMl: number | null;
}): void {
  if (p.mlPerUnit !== null && p.category === 'supply') {
    throw invalid('mlPerUnit', 'Insumo não é cobrado por ml — deixe o ml por unidade em branco');
  }
  if (p.mlPerUnit !== null && p.unit === 'ml') {
    throw invalid('mlPerUnit', 'O produto já é comprado em ml — deixe o ml por unidade em branco');
  }
  if (p.category === 'vaccine' && p.unit !== 'ml' && p.mlPerUnit === null) {
    throw invalid('mlPerUnit', 'Informe quantos ml tem cada unidade da vacina — a vacinação é registrada em ml');
  }
  if (p.applicationMl !== null && p.category !== 'vaccine') {
    throw invalid('applicationMl', 'Volume de aplicação só se aplica a vacina');
  }
}

/** RF-VAC-005: intervalo de dose é de vacina — em medicamento ou insumo não tem significado. */
function requireVaccineForInterval(category: string, doseIntervalDays: number | null | undefined): void {
  if (category !== 'vaccine' && doseIntervalDays !== undefined && doseIntervalDays !== null) {
    throw AppError.validation('Intervalo de dose só se aplica a vacina', [
      { field: 'doseIntervalDays', message: 'Informe o intervalo apenas em produto da categoria vacina' },
    ]);
  }
}
