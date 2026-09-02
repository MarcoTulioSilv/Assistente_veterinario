import { z } from 'zod';

/**
 * Validação de entrada — Dev 2 é o dono desta camada.
 * Toda rota valida o body ANTES de chegar ao Service.
 */
export const createAnimalSchema = z.object({
  name: z.string().min(1).max(255),
  species: z.string().max(50).optional(), // default "equine" no Prisma
  sex: z.enum(['male', 'female']).optional(),
  breed: z.string().max(100).optional(),
  coat: z.string().max(200).optional(),
  birthDate: z.string().date().optional(), // ISO 8601 (YYYY-MM-DD) — mesmo formato de ISODateString
  castrated: z.coerce.boolean().optional(),
  photoUrl: z.string().url().optional(),
  sketchUrl: z.string().url().optional(),
  propertyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});

export const updateAnimalSchema = createAnimalSchema.partial();

export const listAnimalsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(['pending', 'active', 'all']).default('active'),
  propertyId: z.string().uuid().optional(),
});

export const transferAnimalSchema = z.object({
  toPropertyId: z.string().uuid(),
  notes: z.string().max(1000).optional(),
});

export type CreateAnimalInput = z.infer<typeof createAnimalSchema>;
export type UpdateAnimalInput = z.infer<typeof updateAnimalSchema>;
export type ListAnimalsInput = z.infer<typeof listAnimalsSchema>;
export type TransferAnimalInput = z.infer<typeof transferAnimalSchema>;
