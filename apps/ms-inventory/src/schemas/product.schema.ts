import { z } from 'zod';

const PRODUCT_UNITS = [
  'ampola', 'bolsa', 'caixa', 'frasco', 'galao',
  'grama', 'kg', 'litros', 'ml', 'pacote', 'peca', 'unidade',
] as const;

const PRODUCT_CATEGORIES = ['medication', 'vaccine', 'supply'] as const;

/**
 * Reunião de 2026-11-03: unidade válida depende da categoria. Por ora só
 * vacina tem lista fechada (pedido explícito da reunião) — "dose" não
 * entra aqui porque já é coberto por `dosesPerUnit` (frasco de N doses),
 * não é um valor de `unit`. medication/supply continuam aceitando
 * qualquer unidade até vir uma lista específica pra elas.
 */
const CATEGORY_UNITS: Record<(typeof PRODUCT_CATEGORIES)[number], readonly (typeof PRODUCT_UNITS)[number][]> = {
  vaccine: ['ml', 'frasco', 'ampola'],
  medication: PRODUCT_UNITS,
  supply: PRODUCT_UNITS,
};

function unitAllowedForCategory(
  category: (typeof PRODUCT_CATEGORIES)[number],
  unit: (typeof PRODUCT_UNITS)[number],
): boolean {
  return CATEGORY_UNITS[category].includes(unit);
}

/**
 * Validação de entrada — Dev 2 é o dono desta camada.
 * Toda rota valida o body ANTES de chegar ao Service.
 */
const baseProductSchema = z.object({
  name: z.string().min(2).max(255),
  manufacturer: z.string().max(255).optional(),
  batch: z.string().max(100).optional(),
  unit: z.enum(PRODUCT_UNITS),
  quantityInStock: z.coerce.number().min(0).optional(),
  dosesPerUnit: z.coerce.number().positive().optional(),
  costPriceCents: z.coerce.number().int().min(0),
  markupPercent: z.coerce.number().min(0).optional(),
  expiryDate: z.string().date().optional(),
  alertDaysBefore: z.coerce.number().int().min(0).optional(),
  minStockQty: z.coerce.number().min(0).optional(),
  category: z.enum(PRODUCT_CATEGORIES),
  /**
   * RF-VAC-005: intervalo entre doses, em dias — base do alerta de
   * re-vacinação. Só faz sentido em vacina (regra no StockService); `null`
   * na edição tira o intervalo. Até 10 anos: além disso é erro de digitação.
   */
  doseIntervalDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
});

export const createProductSchema = baseProductSchema.refine(
  (data) => unitAllowedForCategory(data.category, data.unit),
  (data) => ({
    message: `Unidade "${data.unit}" não é válida para a categoria "${data.category}"`,
    path: ['unit'],
  }),
);

// `quantityInStock` de propósito fora do update: mudar o estoque só via
// StockMovement (RF-EST-007) — permitir aqui contornaria o ledger, mesmo
// problema que RN-010 evita pra transferência de animal entre propriedades.
//
// O refine só valida quando os DOIS campos vêm juntos no mesmo PATCH — igual
// doseIntervalDays (StockService.update), um PATCH que só troca a categoria
// sem tocar na unidade não passa por aqui (precisaria do registro existente,
// que o schema não tem acesso).
export const updateProductSchema = baseProductSchema
  .omit({ quantityInStock: true })
  .partial()
  .refine(
    (data) => data.category === undefined || data.unit === undefined || unitAllowedForCategory(data.category, data.unit),
    (data) => ({
      message: `Unidade "${data.unit}" não é válida para a categoria "${data.category}"`,
      path: ['unit'],
    }),
  );

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsInput = z.infer<typeof listProductsSchema>;
