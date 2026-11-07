import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, 'Código TOTP deve conter 6 dígitos')
    .optional(),
});

// Refresh e logout não têm corpo: o refresh token chega no cookie HttpOnly
// (ver lib/refresh-cookie.ts).

export type LoginInput = z.infer<typeof loginSchema>;
