import { z } from 'zod';

/**
 * `ownerId` opcional: presente, o controller roteia pra
 * `IFinancialService.listByOwner()` (RF-ATD-008, aba do proprietário);
 * ausente, pro `list()` normal — mesmo padrão do `animalId` em
 * ms-clinical/appointment.schema.ts.
 */
export const listFinancialRecordsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
  ownerId: z.string().uuid().optional(),
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

/**
 * `exam.charged` e `exam.deleted` têm a mesma forma: o pedido, o
 * proprietário, o valor congelado e a data da pendência (coleta, ou envio
 * ao laboratório se outra pessoa coletou).
 */
const examChargePayloadSchema = z.object({
  examRequestId: z.string().uuid(),
  ownerId: z.string().uuid(),
  totalCostCents: z.number().int().min(0),
  performedAt: z.string().datetime(),
});

export const examChargedPayloadSchema = examChargePayloadSchema;
export const examDeletedPayloadSchema = examChargePayloadSchema;

/** Path params de GET /financial/by-source/:sourceType/:sourceId. */
export const findBySourceParamsSchema = z.object({
  sourceType: z.enum(['appointment', 'exam', 'vaccination']),
  sourceId: z.string().uuid(),
});

/**
 * `vaccination.applied` também vai pro MS2 (baixa); aqui só interessa o que
 * vira pendência. Campos extras do payload são ignorados pelo Zod.
 */
export const vaccinationAppliedPayloadSchema = z.object({
  vaccinationId: z.string().uuid(),
  ownerId: z.string().uuid(),
  totalCostCents: z.number().int().min(0),
  performedAt: z.string().datetime(),
});

export const vaccinationDeletedPayloadSchema = vaccinationAppliedPayloadSchema;

export type ListFinancialRecordsInput = z.infer<typeof listFinancialRecordsSchema>;
export type AppointmentDonePayloadInput = z.infer<typeof appointmentDonePayloadSchema>;
export type FindBySourceParamsInput = z.infer<typeof findBySourceParamsSchema>;
