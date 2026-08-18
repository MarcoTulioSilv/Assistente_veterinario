import { z } from 'zod';

const CPF_RE = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
const CNPJ_RE = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

/**
 * RF-CAD-030 (ERS) — cadastro do veterinário. logoUrl aceita só uma URL já
 * hospedada; não há upload de arquivo (S3/R2) implementado nesta tarefa —
 * ver TODO em tenant.repository.ts / ITenantService.
 */
export const registerTenantSchema = z.object({
  fullName: z.string().min(2).max(255),
  crmv: z.string().min(1).max(30),
  crmvState: z.string().length(2),
  cpfCnpj: z.string().refine((v) => CPF_RE.test(v) || CNPJ_RE.test(v), 'CPF ou CNPJ inválido'),
  phone: z.string().max(20),
  email: z.string().email(),
  password: z.string().min(8),
  logoUrl: z.string().url().optional(),
  tenantName: z.string().min(2).max(200).optional(),
});

/** Não inclui crmv/crmvState/cpfCnpj — documentos de identidade não são editáveis por essa rota. */
export const updateVeterinarianSchema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  logoUrl: z.string().url().optional(),
});

export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type UpdateVeterinarianInput = z.infer<typeof updateVeterinarianSchema>;
