import { z } from 'zod';

/**
 * Validação de entrada — mas de broker, não HTTP. É o primeiro consumidor
 * de evento do projeto: nada garante em runtime que o payload que chega
 * pela fila é bem formado (diferente de input HTTP, que já passa por
 * validate()) — um `ms-clinical` com bug poderia publicar algo inválido
 * e corromper contagem de estoque silenciosamente sem isso.
 */
export const appointmentDonePayloadSchema = z.object({
  appointmentId: z.string().uuid(),
  ownerId: z.string().uuid(),
  totalCostCents: z.number().int().min(0),
  consumedItems: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export type AppointmentDonePayloadInput = z.infer<typeof appointmentDonePayloadSchema>;
