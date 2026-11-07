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
  // Lista VAZIA é válida: atendimento só de procedimento (consulta sem
  // produto do estoque) também publica appointment.done, porque o MS6 abre
  // a pendência financeira a partir do mesmo evento (ADR-001 §5.3). Aqui
  // isso só significa "nada a baixar". Já foi `.min(1)` — e todo
  // atendimento sem produto falhava 5 vezes no broker antes de desistir.
  consumedItems: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().positive(),
    }),
  ),
});

export type AppointmentDonePayloadInput = z.infer<typeof appointmentDonePayloadSchema>;
