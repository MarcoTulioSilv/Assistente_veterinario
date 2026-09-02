import { z } from 'zod';

/**
 * Espelha createAnimalSchema do ms-identity. RF-CAD-025: o cadastro só
 * fica "ativo" quando propriedade E proprietário estão atribuídos —
 * dados descritivos (sexo/raça/pelagem/data) sozinhos não ativam.
 * propertyId não entra aqui: mudar de propriedade é só via transferência
 * (RN-010), pra manter o histórico -- ver AnimalForm.
 */
export const animalFormSchema = z.object({
  name: z.string().min(1, 'Informe o nome').max(255),
  species: z.string().max(50).optional().or(z.literal('')),
  sex: z.enum(['male', 'female', '']).optional(),
  breed: z.string().max(100).optional().or(z.literal('')),
  coat: z.string().max(200).optional().or(z.literal('')),
  birthDate: z.string().optional().or(z.literal('')),
  castrated: z.boolean().optional(),
  photoUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  sketchUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  ownerId: z.string().optional().or(z.literal('')),
});

export type AnimalFormValues = z.infer<typeof animalFormSchema>;
