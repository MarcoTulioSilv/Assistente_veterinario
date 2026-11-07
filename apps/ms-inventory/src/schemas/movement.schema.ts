import { z } from 'zod';

/**
 * RF-EST-007 — lançamento manual de movimentação (sem depender do broker).
 * `reason` fica restrito a 'purchase'/'manual' aqui: as demais razões do
 * enum Prisma (appointment/exam/vaccination/expired) só existem via
 * DeductionService/AlertService, que consomem eventos, não este endpoint.
 */
export const createMovementSchema = z.object({
  type: z.enum(['in', 'out']),
  quantity: z.coerce.number().positive(),
  reason: z.enum(['purchase', 'manual']),
  notes: z.string().max(1000).optional(),
});

export const listMovementsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type ListMovementsInput = z.infer<typeof listMovementsSchema>;
