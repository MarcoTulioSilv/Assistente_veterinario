import { z } from 'zod';

/**
 * Payload de `vaccination.applied` (RF-VAC-002). Mesmo motivo do
 * appointment-done.schema: payload de broker não passa por validate(),
 * então é validado aqui. Chega em ML — a conversão para frascos é do
 * StockService.deduct, que conhece o produto.
 */
export const vaccinationAppliedPayloadSchema = z.object({
  vaccinationId: z.string().uuid(),
  productId: z.string().uuid(),
  totalMl: z.number().positive(),
});

export type VaccinationAppliedPayloadInput = z.infer<typeof vaccinationAppliedPayloadSchema>;
