import { z } from 'zod';

const decimalRegex = /^\d+([.,]\d+)?$/;
const integerRegex = /^\d+$/;

/**
 * Espelha createProductSchema do ms-inventory (RF-EST-001/002/003).
 * A conversão pra número/centavos acontece no page (toCreateDto/toUpdateDto),
 * igual PropertyForm/AnimalForm — aqui só valida formato.
 *
 * quantityInStock só é usado na criação (ver `showStock` no ProductForm):
 * editar estoque direto no PATCH contornaria o ledger de movimentações
 * (RF-EST-007), mesma razão de propertyId ficar fora do schema de animais
 * (RN-010) — troca de estoque é sempre via lançamento de movimentação.
 */
export const productFormSchema = z.object({
  name: z.string().min(2, 'Informe o nome do produto').max(255),
  manufacturer: z.string().max(255).optional().or(z.literal('')),
  batch: z.string().max(100).optional().or(z.literal('')),
  unit: z.string().min(1, 'Selecione a unidade'),
  category: z.string().min(1, 'Selecione a categoria'),
  quantityInStock: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
  dosesPerUnit: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
  costPrice: z.string().regex(decimalRegex, 'Informe um valor de custo válido'),
  markupPercent: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  alertDaysBefore: z.string().regex(integerRegex, 'Informe um número inteiro').optional().or(z.literal('')),
  minStockQty: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

/** Lançamento manual de movimentação (RF-EST-007) — espelha createMovementSchema. */
export const movementFormSchema = z.object({
  type: z.enum(['in', 'out']),
  quantity: z.string().regex(decimalRegex, 'Informe uma quantidade válida'),
  reason: z.enum(['purchase', 'manual']),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

export type MovementFormValues = z.infer<typeof movementFormSchema>;
