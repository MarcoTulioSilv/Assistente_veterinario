import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import type { RequestContext, UserRole, TenantPlan } from '@quironequine/shared-types';
import { AppError } from './errors';

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}

interface JwtClaims {
  sub: string;
  tid: string;
  role: UserRole;
  plan: TenantPlan;
}

/**
 * Deriva a chave HMAC a partir de JWT_SECRET. Exportada porque quem assina
 * tokens (AuthService) precisa gerar a mesma chave, byte a byte, que quem
 * verifica aqui — duplicar essa lógica arriscaria os dois lados divergirem.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ausente ou com menos de 32 caracteres');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Valida o Bearer JWT e monta o RequestContext.
 * O tenantId NUNCA vem do cliente — sempre do token (ADR-001 §5.2).
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthorized('Token ausente'));
    return;
  }

  const token = header.slice(7);

  jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] })
    .then(({ payload }) => {
      const claims = payload as unknown as JwtClaims;
      if (!claims.sub || !claims.tid) {
        throw AppError.unauthorized('Token sem claims obrigatórias');
      }
      req.ctx = {
        userId: claims.sub,
        tenantId: claims.tid,
        role: claims.role,
        plan: claims.plan,
        traceId: req.traceId,
      };
      next();
    })
    .catch(() => next(AppError.unauthorized('Token inválido ou expirado')));
}

/** Restringe rota a determinados papéis */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!roles.includes(req.ctx.role)) {
      next(AppError.forbidden('Papel sem permissão para esta operação'));
      return;
    }
    next();
  };
}

/** Restringe rota ao plano Plus */
export function requirePlus(req: Request, _res: Response, next: NextFunction): void {
  if (req.ctx.plan !== 'plus') {
    next(AppError.forbidden('Recurso disponível apenas no Plano Plus'));
    return;
  }
  next();
}
