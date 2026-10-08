import { z } from 'zod';

/** RF-VAC-001: registrar é aplicar — o registro já dá baixa e cobra. */
export const createVaccinationSchema = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  productId: z.string().uuid(),
  // Cópias do produto do MS2 — ver CreateVaccinationDto em shared-types.
  vaccineName: z.string().min(1).max(255),
  vaccineBatch: z.string().min(1).max(100).optional(),
  pricePerDoseCents: z.number().int().min(0),
  doseIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** Individual ou seleção múltipla — ao menos um animal. */
  animalIds: z.array(z.string().uuid()).min(1).max(500),
  dosesPerAnimal: z.number().positive().max(100).optional(),
  appliedAt: z.string().datetime(),
  laborCents: z.number().int().min(0).optional(),
  displacementKm: z.number().min(0).optional(),
  displacementRateCents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

/** `animalId` presente → histórico do animal (RF-VAC-004), igual ao atendimento. */
export const listVaccinationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  animalId: z.string().uuid().optional(),
});

export type CreateVaccinationInput = z.infer<typeof createVaccinationSchema>;
export type ListVaccinationsInput = z.infer<typeof listVaccinationsSchema>;
