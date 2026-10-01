import { z } from 'zod';

export const listFinancialRecordsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
});

/**
 * Valida o payload que chega do broker. Diferente de entrada HTTP — que já
 * passa pelo validate() no controller —, nada garante em runtime que um
 * evento vindo do broker tem a forma esperada: quem publica é outro
 * serviço, com outro deploy e outra versão do contrato.
 */
export const appointmentDonePayloadSchema = z.object({
  appointmentId: z.string().uuid(),
  ownerId: z.string().uuid(),
  totalCostCents: z.number().int().min(0),
  consumedItems: z.array(
    z.object({ productId: z.string().uuid(), quantity: z.number().positive() }),
  ),
  // Opcional só pra eventos publicados antes de o campo existir e que ainda
  // estejam na fila no momento do deploy — o handler cai no occurredAt.
  performedAt: z.string().datetime().optional(),
});

export const appointmentDeletedPayloadSchema = z.object({
  appointmentId: z.string().uuid(),
  ownerId: z.string().uuid(),
  totalCostCents: z.number().int().min(0),
  performedAt: z.string().datetime(),
});

export type ListFinancialRecordsInput = z.infer<typeof listFinancialRecordsSchema>;
export type AppointmentDonePayloadInput = z.infer<typeof appointmentDonePayloadSchema>;
