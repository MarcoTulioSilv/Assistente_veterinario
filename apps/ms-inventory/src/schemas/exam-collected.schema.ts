import { z } from 'zod';

/**
 * Payload de `exam.collected` — o veterinário colheu a amostra e usou
 * insumos (RF-EXM-006). Mesmo motivo do appointment-done.schema: payload
 * de broker não passa por validate(), então é validado aqui.
 *
 * Diferente do atendimento, o MS3 só publica este evento quando há insumo,
 * mas lista vazia continua sendo aceita (é só "nada a baixar").
 */
export const examCollectedPayloadSchema = z.object({
  examRequestId: z.string().uuid(),
  consumedItems: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().positive(),
    }),
  ),
});

export type ExamCollectedPayloadInput = z.infer<typeof examCollectedPayloadSchema>;
