import type {
  IExpenseService,
  RequestContext,
  UUID,
  Paginated,
  Expense,
  ExpenseCategory,
  CreateExpenseDto,
  UpdateExpenseDto,
  StockPurchaseDto,
  ListExpensesParams,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ExpenseRepository, ExpenseData } from '../repositories/expense.repository';
import { assertPlus } from './plus-only';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT_CENTS = 1_000_000_000; // mesmo teto do CHECK
const MAX_LIST_DAYS = 731;
const MAX_PAGE_SIZE = 100;
const MANUAL_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set([
  'fuel',
  'vehicle_maintenance',
  'supplies_equipment',
  'taxes_fees',
  'other',
]);

type FieldError = { field: string; message: string };

/** 'AAAA-MM-DD' de verdade (rejeita 2026-02-30). */
function isValidDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function checkDay(day: string, field: string, errors: FieldError[]): void {
  if (!isValidDay(day)) errors.push({ field, message: 'Use uma data válida no formato AAAA-MM-DD' });
}

function checkAmount(amountCents: number, errors: FieldError[]): void {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    errors.push({ field: 'amountCents', message: 'Informe um valor maior que zero, em centavos' });
  }
}

function cleanDescription(description: string | undefined | null): string | null {
  const trimmed = description?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function throwIfErrors(errors: FieldError[]): void {
  if (errors.length > 0) throw AppError.validation('Saída inválida', errors);
}

/**
 * Lógica de negócio — Dev 1 é o dono. Saídas de caixa: avulsas (RF-REL-002)
 * e compras de estoque lançadas à mão (decisão de 12/11/2026; regra fina na
 * próxima reunião). Só no Plano Plus (ERS §2.6).
 */
export class ExpenseService implements IExpenseService {
  constructor(
    private readonly repo: ExpenseRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ctx: RequestContext, params: ListExpensesParams): Promise<Paginated<Expense>> {
    assertPlus(ctx);
    const errors: FieldError[] = [];
    if (params.fromDay !== undefined) checkDay(params.fromDay, 'fromDay', errors);
    if (params.toDay !== undefined) checkDay(params.toDay, 'toDay', errors);
    throwIfErrors(errors);
    if (params.fromDay && params.toDay) {
      const days = (Date.parse(params.toDay) - Date.parse(params.fromDay)) / 86_400_000;
      if (days < 0) throw AppError.validation('Período inválido', [{ field: 'toDay', message: 'O fim deve ser depois do início' }]);
      if (days > MAX_LIST_DAYS) {
        throw AppError.validation('Período inválido', [{ field: 'toDay', message: 'Período de no máximo 24 meses' }]);
      }
    }
    return this.repo.list(ctx, {
      page: Math.max(1, params.page ?? 1),
      limit: Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? 20)),
      ...(params.fromDay ? { fromDay: params.fromDay } : {}),
      ...(params.toDay ? { toDay: params.toDay } : {}),
      ...(params.category ? { category: params.category } : {}),
    });
  }

  /** RF-REL-002: saída avulsa, com descrição. */
  async create(ctx: RequestContext, data: CreateExpenseDto): Promise<Expense> {
    assertPlus(ctx);
    const errors: FieldError[] = [];
    checkDay(data.occurredOn, 'occurredOn', errors);
    checkAmount(data.amountCents, errors);
    if (!MANUAL_CATEGORIES.has(data.category)) {
      errors.push({ field: 'category', message: 'Categoria inválida para saída avulsa' });
    }
    const description = cleanDescription(data.description);
    if (!description) errors.push({ field: 'description', message: 'Descreva a saída' });
    else if (description.length > 255) errors.push({ field: 'description', message: 'No máximo 255 caracteres' });
    throwIfErrors(errors);

    return this.repo.create(ctx, {
      occurredOn: data.occurredOn,
      category: data.category,
      description,
      amountCents: data.amountCents,
      productId: null,
    });
  }

  /** Compra de estoque no caixa, lançada à mão (regra mínima). */
  async registerStockPurchase(ctx: RequestContext, data: StockPurchaseDto): Promise<Expense> {
    assertPlus(ctx);
    const errors: FieldError[] = [];
    checkDay(data.occurredOn, 'occurredOn', errors);
    checkAmount(data.amountCents, errors);
    const description = cleanDescription(data.description);
    if (description && description.length > 255) errors.push({ field: 'description', message: 'No máximo 255 caracteres' });
    throwIfErrors(errors);

    return this.repo.create(ctx, {
      occurredOn: data.occurredOn,
      category: 'stock_purchase',
      description,
      amountCents: data.amountCents,
      productId: data.productId ?? null,
    });
  }

  /** A categoria não troca entre avulsa e compra de estoque (são operações diferentes). */
  async update(ctx: RequestContext, id: UUID, data: UpdateExpenseDto): Promise<Expense> {
    assertPlus(ctx);
    const current = await this.repo.findById(ctx, id);
    if (!current) throw AppError.notFound('Saída não encontrada');

    const errors: FieldError[] = [];
    const patch: Partial<ExpenseData> = {};
    if (data.occurredOn !== undefined) {
      checkDay(data.occurredOn, 'occurredOn', errors);
      patch.occurredOn = data.occurredOn;
    }
    if (data.amountCents !== undefined) {
      checkAmount(data.amountCents, errors);
      patch.amountCents = data.amountCents;
    }
    if (data.category !== undefined) {
      if (current.category === 'stock_purchase' || !MANUAL_CATEGORIES.has(data.category)) {
        errors.push({ field: 'category', message: 'Compra de estoque e saída avulsa não trocam de categoria' });
      } else {
        patch.category = data.category;
      }
    }
    if (data.description !== undefined) {
      const description = cleanDescription(data.description);
      if (!description && current.category !== 'stock_purchase') errors.push({ field: 'description', message: 'Descreva a saída' });
      else if (description && description.length > 255) errors.push({ field: 'description', message: 'No máximo 255 caracteres' });
      patch.description = description;
    }
    throwIfErrors(errors);

    const updated = await this.repo.update(ctx, id, patch);
    if (!updated) throw AppError.notFound('Saída não encontrada');
    return updated;
  }

  async remove(ctx: RequestContext, id: UUID): Promise<void> {
    assertPlus(ctx);
    if (!(await this.repo.softDelete(ctx, id, this.now()))) throw AppError.notFound('Saída não encontrada');
  }
}
