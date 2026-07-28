import { z } from 'zod';

/**
 * Validação de entrada — Dev 2 é o dono desta camada.
 * Toda rota valida o body ANTES de chegar ao Service.
 */
export const createOwnerSchema = z.object({
  fullName: z.string().min(2).max(255),
  cpf: z
    .string()
    .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF deve estar no formato 000.000.000-00')
    .optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  phone2: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  propertyIds: z.array(z.string().uuid()).optional(),
});

export const updateOwnerSchema = createOwnerSchema.partial();

export const listOwnersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(['pending', 'active', 'all']).default('active'),
});

export type CreateOwnerInput = z.infer<typeof createOwnerSchema>;
export type UpdateOwnerInput = z.infer<typeof updateOwnerSchema>;
export type ListOwnersInput = z.infer<typeof listOwnersSchema>;
