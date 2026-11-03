import { z } from 'zod';

const decimalRegex = /^\d+([.,]\d+)?$/;

/**
 * Espelha createAppointmentSchema do ms-clinical pós reunião de 20/10/2026
 * (orçamento com vários animais) — itens agora são só produtos do estoque
 * (`kind`/procedimento saíram, ver AppointmentItem em shared-types).
 */
export const appointmentItemFormSchema = z.object({
  productId: z.string().min(1, 'Selecione o produto'),
  description: z.string().min(1, 'Descreva o item').max(255),
  quantity: z.string().regex(decimalRegex, 'Quantidade inválida'),
  unitPriceCents: z.string().regex(decimalRegex, 'Valor inválido'),
});

export const appointmentFormSchema = z.object({
  title: z.string().max(255).optional().or(z.literal('')),
  type: z.enum(['clinico_geral', 'reproducao', 'odontologico', 'locomotor', 'cirurgia'], {
    errorMap: () => ({ message: 'Selecione o tipo de atendimento' }),
  }),
  performedAt: z.string().min(1, 'Informe a data e hora'),
  animalLocation: z.string().max(255).optional().or(z.literal('')),
  procedureDescription: z.string().optional().or(z.literal('')),
  laborCents: z.string().regex(decimalRegex, 'Valor inválido').optional().or(z.literal('')),
  displacementKm: z.string().regex(decimalRegex, 'Número inválido').optional().or(z.literal('')),
  displacementRateCents: z.string().regex(decimalRegex, 'Valor inválido').optional().or(z.literal('')),
});

/** RF-ATD-005, de um animal — espelha prescriptionSchema do ms-clinical. */
export const prescriptionFormSchema = z.object({
  productId: z.string().optional().or(z.literal('')),
  medicationName: z.string().min(1, 'Informe o medicamento').max(255),
  dose: z.string().min(1, 'Informe a dose').max(100),
  route: z.enum(['oral', 'intravenosa', 'intramuscular', 'subcutanea', 'topica', 'intrauterina', 'outra'], {
    errorMap: () => ({ message: 'Selecione a via' }),
  }),
  schedule: z.string().min(1, 'Informe a frequência').max(255),
  applicationSite: z.string().max(255).optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

/** RF-ATD-001, de um animal — os campos JSONB (exames geral/especial) ficam fora por ora. */
export interface MedicalRecordFormValues {
  anamnesis: string;
  diagnosis: string;
  treatment: string;
  prognosis: string;
  referral: string;
}

export const EMPTY_MEDICAL_RECORD: MedicalRecordFormValues = {
  anamnesis: '',
  diagnosis: '',
  treatment: '',
  prognosis: '',
  referral: '',
};

export interface AnimalClinicalFormValues {
  medicalRecord: MedicalRecordFormValues;
  prescriptions: PrescriptionFormValues[];
}

export type AppointmentItemFormValues = z.infer<typeof appointmentItemFormSchema>;
export type AppointmentFormValues = z.infer<typeof appointmentFormSchema>;
export type PrescriptionFormValues = z.infer<typeof prescriptionFormSchema>;
