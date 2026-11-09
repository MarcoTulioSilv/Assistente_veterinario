import { Router, type Response } from 'express';
import type { AuthSession, AuthTokens, IAuthService } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthService, refreshTokenTtlMs } from '../services/auth.service';
import { validate } from '../schemas/validate';
import { loginSchema } from '../schemas/auth.schema';
import type { LoginInput } from '../schemas/auth.schema';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../lib/refresh-cookie';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Rota pública (montada antes de authMiddleware em app.ts) — login/refresh
 * não têm req.ctx ainda. Só trata protocolo: parse, validação, status code.
 *
 * O refresh token vai e volta só pelo cookie HttpOnly (ver
 * lib/refresh-cookie.ts); o corpo das respostas é um AuthSession, sem ele.
 */

/** Grava o refresh token no cookie e devolve o resto ao cliente. */
function sendSession(res: Response, tokens: AuthTokens): void {
  const { refreshToken, ...session } = tokens;
  setRefreshCookie(res, refreshToken, refreshTokenTtlMs());
  res.json(session satisfies AuthSession);
}

export function createAuthRouter(service: IAuthService): Router {
  const router = Router();

  router.post('/login', validate(loginSchema), async (req, res, next) => {
    try {
      const { email, password, totpCode } = req.body as LoginInput;
      sendSession(res, await service.login(email, password, totpCode));
    } catch (e) {
      next(e);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const refreshToken = readRefreshCookie(req);
      if (!refreshToken) throw AppError.unauthorized('Sessão inválida');
      sendSession(res, await service.refresh(refreshToken));
    } catch (e) {
      // Qualquer falha de refresh encerra a sessão no cliente: o cookie que
      // não serve mais não fica circulando.
      clearRefreshCookie(res);
      next(e);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const refreshToken = readRefreshCookie(req);
      // Sempre 204: revoga a sessão deste aparelho se o token for válido, e
      // não diz nada se não for (ver AuthService.logout).
      if (refreshToken) await service.logout(refreshToken);
      clearRefreshCookie(res);
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export const authRouter = createAuthRouter(new AuthService(new AuthRepository()));
