import { z } from 'zod';

/**
 * Espelha createOwnerSchema do ms-identity. RN-006: o cadastro só fica
 * "ativo" quando CPF e telefone estão preenchidos — os dois continuam
 * opcionais aqui (o backend decide o status), só avisamos na tela.
 */
export const ownerFormSchema = z.object({
  fullName: z.string().min(2, 'Informe o nome completo').max(255),
  cpf: z
    .string()
    .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF deve estar no formato 000.000.000-00')
    .optional()
    .or(z.literal('')),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  phone2: z.string().max(20).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  state: z.string().length(2, 'Selecione o estado').optional().or(z.literal('')),
});

export type OwnerFormValues = z.infer<typeof ownerFormSchema>;
