import { Router } from 'express';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthService } from '../services/auth.service';
import { validate } from '../schemas/validate';
import { loginSchema, refreshSchema, logoutSchema } from '../schemas/auth.schema';
import type { LoginInput, RefreshInput, LogoutInput } from '../schemas/auth.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Rota pública (montada antes de authMiddleware em app.ts) — login/refresh
 * não têm req.ctx ainda. Só trata protocolo: parse, validação, status code.
 */
export const authRouter = Router();

// Injeção de dependências — trocar por MockAuthService quando necessário
const service = new AuthService(new AuthRepository());

authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, totpCode } = req.body as LoginInput;
    res.json(await service.login(email, password, totpCode));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as RefreshInput;
    res.json(await service.refresh(refreshToken));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', validate(logoutSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as LogoutInput;
    // IAuthService.logout(userId) não recebe o token — resolve e valida
    // a posse dele aqui antes de chamar o service (ver ADR-004).
    const { userId } = await service.verifyRefreshToken(refreshToken);
    await service.logout(userId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
