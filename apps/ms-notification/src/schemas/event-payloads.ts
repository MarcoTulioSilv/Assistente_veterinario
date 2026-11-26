import { z } from 'zod';

/**
 * Payloads que chegam do broker — Dev 1 é o dono (mesmo padrão do MS4 e do
 * MS6). Só os campos que o MS5 usa; o resto é ignorado. Valida porque quem
 * publica é outro serviço, com outro deploy.
 */
const isoDate = z.string().datetime({ offset: true });

export const scheduleReminderDueSchema = z.object({
  scheduleEventId: z.string().uuid(),
  activityType: z.enum(['appointment', 'visit', 'vaccination', 'exam', 'other']),
  startsAt: isoDate,
  minutesBefore: z.number().int().min(0),
  propertyId: z.string().uuid().nullable(),
  recipientUserId: z.string().uuid(),
});

export const examResultDueSchema = z.object({
  examRequestId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  examTypeName: z.string().max(255),
  expectedResultAt: isoDate,
  kind: z.enum(['day_before', 'due_today']),
});

export const vaccinationDueSchema = z.object({
  vaccinationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  veterinarianId: z.string().uuid(),
  vaccineName: z.string().max(255),
  animalIds: z.array(z.string().uuid()).max(500),
  nextDoseAt: isoDate,
  kind: z.enum(['week_before', 'due_today']),
});

export const alertTriggeredSchema = z.object({
  productId: z.string().uuid(),
  alertType: z.enum(['expiry', 'low_stock']),
  productName: z.string().max(255),
  expiryDate: isoDate.optional(),
  quantityInStock: z.number().optional(),
});

export const accountEmailSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().max(255),
  token: z.string().min(16).max(200),
  expiresAt: isoDate,
});
