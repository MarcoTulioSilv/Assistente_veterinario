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
 * RF-ATD-006/007: item do orçamento — sempre produto do estoque, que gera
 * baixa (RN-003). O procedimento saiu dos itens (reunião de 20/10/2026): é
 * texto em `procedureDescription`, e o valor vai em `laborCents`.
 */
export const appointmentItemSchema = z.object({
  productId: z.string().uuid(),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().min(0),
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

/** Ficha e receita de UM animal do orçamento. */
export const appointmentAnimalClinicalSchema = z.object({
  animalId: z.string().uuid(),
  medicalRecord: medicalRecordSchema.optional(),
  prescriptions: z.array(prescriptionSchema).max(50).optional(),
});

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const appointmentFields = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  type: appointmentTypeSchema,
  /** Vários animais por orçamento (reunião de 20/10/2026). */
  animalIds: z.array(z.string().uuid()).min(1).max(200),
  title: z.string().trim().min(1).max(255).optional(),
  // `null` apaga o campo na edição.
  /** RF-ATD-004 */
  animalLocation: z.string().nullish(),
  locationLatitude: latitude.nullish(),
  locationLongitude: longitude.nullish(),
  performedAt: z.string().datetime(),
  procedureDescription: z.string().max(5000).nullish(),
  laborCents: z.number().int().min(0).optional(),
  displacementKm: z.number().min(0).optional(),
  displacementRateCents: z.number().int().min(0).optional(),
  items: z.array(appointmentItemSchema).max(200).optional(),
  clinical: z.array(appointmentAnimalClinicalSchema).max(200).optional(),
});

/**
 * Ponto no mapa: os dois juntos (informar ou apagar) ou nenhum dos dois —
 * meia coordenada não é lugar nenhum. O banco também barra (CHECK).
 */
function locationIsComplete(value: {
  locationLatitude?: number | null;
  locationLongitude?: number | null;
}): boolean {
  const kind = (v: number | null | undefined): string => (v === undefined ? 'ausente' : v === null ? 'nulo' : 'valor');
  return kind(value.locationLatitude) === kind(value.locationLongitude);
}

const LOCATION_MESSAGE = {
  message: 'Informe latitude e longitude juntas',
  path: ['locationLatitude'],
};

export const createAppointmentSchema = appointmentFields.refine(locationIsComplete, LOCATION_MESSAGE);

export const updateAppointmentSchema = appointmentFields
  .omit({ ownerId: true })
  .partial()
  .refine(locationIsComplete, LOCATION_MESSAGE);

/**
 * `animalId` opcional: presente, o controller roteia pra
 * `IAppointmentService.listByAnimal()` (RF-ATD-011); ausente, pro `list()`
 * normal. `status` filtra "em aberto" (`draft`) e "finalizados" (`finished`)
 * — pedido da tela inicial na reunião de 20/10/2026; vale nos dois.
 */
export const listAppointmentsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  animalId: z.string().uuid().optional(),
  status: z.enum(['draft', 'finished', 'cancelled']).optional(),
});

export type AppointmentItemInput = z.infer<typeof appointmentItemSchema>;
export type PrescriptionInput = z.infer<typeof prescriptionSchema>;
export type MedicalRecordInput = z.infer<typeof medicalRecordSchema>;
export type AppointmentAnimalClinicalInput = z.infer<typeof appointmentAnimalClinicalSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type ListAppointmentsInput = z.infer<typeof listAppointmentsSchema>;
