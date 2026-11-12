import { z } from 'zod';

/**
 * Valida o payload que chega do broker — Dev 1 é o dono (mesmo padrão do
 * MS6). Diferente de entrada HTTP, nada garante em runtime a forma de um
 * evento: quem publica é outro serviço, com outro deploy e outra versão do
 * contrato.
 *
 * Só os campos que o MS4 usa; o resto do payload é ignorado (z.object tira
 * o que não declarou). `propertyId` é opcional porque os eventos publicados
 * antes do campo existir (e que ainda estejam na fila) não o têm — o
 * service ignora esses.
 */
export const appointmentDoneVisitSchema = z.object({
  appointmentId: z.string().uuid(),
  performedAt: z.string().datetime().optional(),
  propertyId: z.string().uuid().optional(),
});

export const vaccinationAppliedVisitSchema = z.object({
  vaccinationId: z.string().uuid(),
  performedAt: z.string().datetime(),
  propertyId: z.string().uuid().optional(),
});
