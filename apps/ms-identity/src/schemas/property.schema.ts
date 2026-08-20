import { z } from 'zod';

/**
 * Validação de entrada — Dev 2 é o dono desta camada.
 * Toda rota valida o body ANTES de chegar ao Service.
 */
export const createPropertySchema = z.object({
  name: z.string().min(2).max(255),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  zipCode: z.string().max(10).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  ownerIds: z.array(z.string().uuid()).optional(),
});

export const updatePropertySchema = createPropertySchema.partial();

export const listPropertiesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(['pending', 'active', 'all']).default('active'),
  ownerId: z.string().uuid().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ListPropertiesInput = z.infer<typeof listPropertiesSchema>;
