import { z } from 'zod';

const decimalRegex = /^\d+([.,]\d+)?$/;

/**
 * Espelha appointmentItemSchema do ms-clinical (RF-ATD-006/007): item de
 * estoque (kind: 'product') exige productId; procedimento não pode ter.
 * Campos numéricos ficam como texto aqui — a conversão pra Cents/number
 * acontece no page (toCreateDto), igual ProductForm/MovementForm.
 */
export const appointmentItemFormSchema = z
  .object({
    kind: z.enum(['product', 'procedure']),
    productId: z.string().optional().or(z.literal('')),
    description: z.string().min(1, 'Descreva o item').max(255),
    quantity: z.string().regex(decimalRegex, 'Quantidade inválida'),
    unitPriceCents: z.string().regex(decimalRegex, 'Valor inválido'),
  })
  .refine((item) => (item.kind === 'product' ? !!item.productId : true), {
    message: 'Selecione o produto',
    path: ['productId'],
  });

/**
 * Espelha createAppointmentSchema do ms-clinical. animalId fica fora: na
 * edição não é mais editável (UpdateAppointmentDto omite animalId/ownerId —
 * RF-ATD-006, orçamento mutável só em rascunho, mas o vínculo com o animal
 * nunca muda), então o form valida animalId separadamente, só na criação.
 */
export const appointmentFormSchema = z.object({
  type: z.enum(['clinico_geral', 'reproducao', 'odontologico', 'locomotor', 'cirurgia'], {
    errorMap: () => ({ message: 'Selecione o tipo de atendimento' }),
  }),
  performedAt: z.string().min(1, 'Informe a data e hora'),
  animalLocation: z.string().max(255).optional().or(z.literal('')),
  laborCents: z.string().regex(decimalRegex, 'Valor inválido').optional().or(z.literal('')),
  displacementKm: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
  displacementRateCents: z.string().regex(decimalRegex, 'Valor inválido').optional().or(z.literal('')),
});

export type AppointmentItemFormValues = z.infer<typeof appointmentItemFormSchema>;
export type AppointmentFormValues = z.infer<typeof appointmentFormSchema>;
