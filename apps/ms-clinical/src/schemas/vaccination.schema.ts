import { z } from 'zod';

const base = {
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  vaccineName: z.string().trim().min(1).max(255),
  vaccineBatch: z.string().min(1).max(100).optional(),
  doseIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** Individual ou seleção múltipla — ao menos um animal. */
  animalIds: z.array(z.string().uuid()).min(1).max(500),
  dosesPerAnimal: z.number().positive().max(100).optional(),
  appliedAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
};

/** RF-VAC-001: aplicação da clínica — registrar é aplicar, o registro já dá baixa e cobra. */
const clinicVaccinationSchema = z.object({
  ...base,
  origin: z.literal('clinic'),
  productId: z.string().uuid(),
  // Cópias do produto do MS2 — ver CreateClinicVaccinationDto em shared-types.
  pricePerDoseCents: z.number().int().min(0),
  laborCents: z.number().int().min(0).optional(),
  displacementKm: z.number().min(0).optional(),
  displacementRateCents: z.number().int().min(0).optional(),
});

/**
 * Vacina aplicada por outra pessoa — só controle. `.strict()`: preço, mão
 * de obra ou km aqui é engano de quem chamou (achou que ia cobrar), e
 * engano em dinheiro não se ignora calado.
 */
const externalVaccinationSchema = z
  .object({
    ...base,
    origin: z.literal('external'),
    productId: z.string().uuid().optional(),
    appliedBy: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

/**
 * `origin` ausente = `clinic`: quem chama não precisa saber que existe o
 * registro externo. Preenchido antes do discriminatedUnion pra que o erro de
 * validação aponte o campo certo, e não um "Invalid input" genérico.
 */
export const createVaccinationSchema = z.preprocess(
  (value) =>
    value !== null && typeof value === 'object' && !('origin' in value)
      ? { ...value, origin: 'clinic' }
      : value,
  z.discriminatedUnion('origin', [clinicVaccinationSchema, externalVaccinationSchema]),
);

/** `animalId` presente → histórico do animal (RF-VAC-004), igual ao atendimento. */
export const listVaccinationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  animalId: z.string().uuid().optional(),
});

export type CreateClinicVaccinationInput = z.infer<typeof clinicVaccinationSchema>;
export type CreateExternalVaccinationInput = z.infer<typeof externalVaccinationSchema>;
export type CreateVaccinationInput = z.infer<typeof createVaccinationSchema>;
export type ListVaccinationsInput = z.infer<typeof listVaccinationsSchema>;
