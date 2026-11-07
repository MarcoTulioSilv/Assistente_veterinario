import { z } from 'zod';

/**
 * Espelha createPropertySchema do ms-identity. RN-006: o cadastro só fica
 * "ativo" quando endereço, cidade e estado estão preenchidos — os três
 * continuam opcionais aqui (o backend decide o status), só avisamos na
 * tela. Latitude/longitude não têm campo — o GeoService resolve sozinho
 * a partir do endereço (RF-CAD-002, Nominatim).
 */
export const propertyFormSchema = z.object({
  name: z.string().min(2, 'Informe o nome da propriedade').max(255),
  address: z.string().max(500).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  state: z.string().length(2, 'Selecione o estado').optional().or(z.literal('')),
  zipCode: z
    .string()
    .regex(/^\d{5}-\d{3}$/, 'CEP deve estar no formato 00000-000')
    .optional()
    .or(z.literal('')),
});

export type PropertyFormValues = z.infer<typeof propertyFormSchema>;
