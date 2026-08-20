import { z } from 'zod';

/**
 * Espelha updateVeterinarianSchema do ms-identity (RF-CAD-030) — não inclui
 * crmv/crmvState/cpfCnpj, que são documentos de identidade não editáveis
 * por esta tela.
 */
export const profileSchema = z.object({
  fullName: z.string().min(2, 'Informe o nome completo').max(255),
  phone: z.string().min(1, 'Informe o telefone').max(20),
  email: z.string().min(1, 'Informe o e-mail').email('E-mail inválido'),
  logoUrl: z
    .string()
    .url('URL inválida')
    .optional()
    .or(z.literal('')),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
