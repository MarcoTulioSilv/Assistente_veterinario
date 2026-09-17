import { z } from 'zod';

const PRODUCT_UNITS = [
  'ampola', 'bolsa', 'caixa', 'frasco', 'galao',
  'grama', 'kg', 'litros', 'ml', 'pacote', 'peca', 'unidade',
] as const;

const PRODUCT_CATEGORIES = ['medication', 'vaccine', 'supply'] as const;

/**
 * Validação de entrada — Dev 2 é o dono desta camada.
 * Toda rota valida o body ANTES de chegar ao Service.
 */
export const createProductSchema = z.object({
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
});

// `quantityInStock` de propósito fora do update: mudar o estoque só via
// StockMovement (RF-EST-007) — permitir aqui contornaria o ledger, mesmo
// problema que RN-010 evita pra transferência de animal entre propriedades.
export const updateProductSchema = createProductSchema.omit({ quantityInStock: true }).partial();

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsInput = z.infer<typeof listProductsSchema>;
