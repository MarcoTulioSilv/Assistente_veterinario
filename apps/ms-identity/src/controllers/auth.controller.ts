import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../schemas/validate';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z.string().length(6).optional(),
});

// TODO Sprint 2 — Dev 1 implementa AuthService (JWT + bcrypt + TOTP)
authRouter.post('/login', validate(loginSchema), async (_req, res) => {
  res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'AuthService — Sprint 2' });
});

authRouter.post('/refresh', async (_req, res) => {
  res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'AuthService — Sprint 2' });
});

authRouter.post('/logout', async (_req, res) => {
  res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'AuthService — Sprint 2' });
});
