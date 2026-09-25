import { z } from 'zod';

/** RF-ATD-002 */
export const appointmentTypeSchema = z.enum([
  'clinico_geral',
  'reproducao',
  'odontologico',
  'locomotor',
  'cirurgia',
]);

/** RF-ATD-005 */
export const administrationRouteSchema = z.enum([
  'oral',
  'intravenosa',
  'intramuscular',
  'subcutanea',
  'topica',
  'intrauterina',
  'outra',
]);

/**
 * RF-ATD-006/007: item do orçamento. `product` sai do estoque e gera baixa
 * (RN-003); `procedure` só cobra. O productId é exigido no primeiro e
 * proibido no segundo — sem isso um procedimento poderia disparar baixa de
 * estoque de um produto que ninguém usou.
 */
export const appointmentItemSchema = z
  .object({
    kind: z.enum(['product', 'procedure']),
    productId: z.string().uuid().optional(),
    description: z.string().min(1).max(255),
    quantity: z.number().positive(),
    unitPriceCents: z.number().int().min(0),
  })
  .refine((item) => (item.kind === 'product' ? item.productId !== undefined : item.productId === undefined), {
    message: 'Item de estoque exige productId; procedimento não pode ter productId',
    path: ['productId'],
  });

export const prescriptionSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  medicationName: z.string().min(1).max(255),
  dose: z.string().min(1).max(100),
  route: administrationRouteSchema,
  schedule: z.string().min(1).max(255),
  applicationSite: z.string().max(255).optional(),
  notes: z.string().optional(),
});

/**
 * RF-ATD-001 — os exames ficam em JSONB, forma livre por tipo de atendimento.
 *
 * `nullish` e não `optional`: o contrato publicado (`CreateMedicalRecordDto`)
 * deriva do domínio, onde os campos são `string | null`. Aceitar null explícito
 * é o que permite limpar um campo já preenchido, em vez de só não mexer nele.
 */
export const medicalRecordSchema = z.object({
  anamnesis: z.string().nullish(),
  generalExam: z.record(z.unknown()).nullish(),
  specialExams: z.record(z.unknown()).nullish(),
  diagnosis: z.string().nullish(),
  treatment: z.string().nullish(),
  prognosis: z.string().nullish(),
  referral: z.string().nullish(),
});

export const createAppointmentSchema = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  animalId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  type: appointmentTypeSchema,
  /** RF-ATD-004 */
  animalLocation: z.string().optional(),
  performedAt: z.string().datetime(),
  laborCents: z.number().int().min(0).optional(),
  displacementKm: z.number().min(0).optional(),
  displacementRateCents: z.number().int().min(0).optional(),
  items: z.array(appointmentItemSchema).optional(),
  prescriptions: z.array(prescriptionSchema).optional(),
  medicalRecord: medicalRecordSchema.optional(),
});

export const updateAppointmentSchema = createAppointmentSchema
  .omit({ ownerId: true, animalId: true })
  .partial();

export const listAppointmentsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AppointmentItemInput = z.infer<typeof appointmentItemSchema>;
export type PrescriptionInput = z.infer<typeof prescriptionSchema>;
export type MedicalRecordInput = z.infer<typeof medicalRecordSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type ListAppointmentsInput = z.infer<typeof listAppointmentsSchema>;
