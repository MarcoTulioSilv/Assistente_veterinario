import { z } from 'zod';

/**
 * RF-EXM-002: um campo do protocolo. A chave vira propriedade do
 * `protocolData` do pedido, então é restrita a um identificador simples.
 */
export const protocolFieldSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e _, começando por letra')
      .max(50),
    label: z.string().min(1).max(100),
    type: z.enum(['text', 'number', 'date', 'select']),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  })
  .refine((field) => (field.type === 'select') === (field.options !== undefined), {
    message: 'options é obrigatório em campo select e só é aceito nele',
    path: ['options'],
  });

export const protocolFieldsSchema = z
  .array(protocolFieldSchema)
  .max(50)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: 'Dois campos do protocolo não podem ter a mesma chave',
  });

export const createExamTypeSchema = z.object({
  name: z.string().min(1).max(255),
  defaultPriceCents: z.number().int().min(0).optional(),
  /** Até um ano — prazo maior que isso é erro de digitação, não exame. */
  expectedTurnaroundDays: z.number().int().min(0).max(365).nullable().optional(),
  protocolFields: protocolFieldsSchema.optional(),
});

export const updateExamTypeSchema = createExamTypeSchema.partial();

export const examRequestItemSchema = z.object({
  productId: z.string().uuid(),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  /** Preço de venda do produto (MS2) — só entra na conta se o cliente paga o laboratório. */
  unitPriceCents: z.number().int().min(0),
});

export const createExamRequestSchema = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  examTypeId: z.string().uuid(),
  /** Validado contra os campos do tipo no service — a forma depende do tipo. */
  protocolData: z.record(z.unknown()).optional(),
  animalIds: z.array(z.string().uuid()).max(500).optional(),
  /** `null` tira o lote do pedido (na edição). */
  lotDescription: z.string().min(1).max(255).nullable().optional(),
  lotSize: z.number().int().positive().nullable().optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  paidDirectlyByClient: z.boolean().optional(),
});

export const updateExamRequestSchema = createExamRequestSchema.omit({ ownerId: true }).partial();

/** `animalId` presente → histórico do animal (RF-CAD-026), igual ao atendimento. */
export const listExamRequestsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  animalId: z.string().uuid().optional(),
});

export const listExamTypesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/** Coleta feita pelo veterinário — etapa opcional do fluxo. */
export const registerExamCollectionSchema = z.object({
  material: z.string().min(1).max(255),
  collectedAt: z.string().datetime(),
  items: z.array(examRequestItemSchema).max(100).optional(),
  laborCents: z.number().int().min(0).optional(),
  displacementKm: z.number().min(0).optional(),
  displacementRateCents: z.number().int().min(0).optional(),
});

export const attachResultSchema = z.object({
  resultFileUrl: z.string().url().max(2000),
});

export type ProtocolFieldInput = z.infer<typeof protocolFieldSchema>;
export type CreateExamTypeInput = z.infer<typeof createExamTypeSchema>;
export type UpdateExamTypeInput = z.infer<typeof updateExamTypeSchema>;
export type ExamRequestItemInput = z.infer<typeof examRequestItemSchema>;
export type CreateExamRequestInput = z.infer<typeof createExamRequestSchema>;
export type UpdateExamRequestInput = z.infer<typeof updateExamRequestSchema>;
export type RegisterExamCollectionInput = z.infer<typeof registerExamCollectionSchema>;
export type ListExamRequestsInput = z.infer<typeof listExamRequestsSchema>;
export type ListExamTypesInput = z.infer<typeof listExamTypesSchema>;
