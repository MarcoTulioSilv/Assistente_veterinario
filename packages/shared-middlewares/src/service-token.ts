import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errors';

/** Cabeçalho com o token de serviço nas chamadas entre microsserviços. */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/** Mesmo tamanho dos dois lados, para o timingSafeEqual: compara os SHA-256. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Protege rotas INTERNAS (`/internal/...`), chamadas por outro microsserviço
 * e nunca pelo navegador (ADR-007): o BFF não encaminha `/internal`, e o
 * token de serviço (`INTERNAL_SERVICE_TOKEN`, o mesmo nos serviços que
 * conversam) é a segunda barreira.
 *
 * Falha fechada: sem a variável configurada, recusa tudo — melhor o MS5 não
 * saber quem avisar do que uma rota interna aberta.
 */
export function requireServiceToken(req: Request, _res: Response, next: NextFunction): void {
  const expected = process.env['INTERNAL_SERVICE_TOKEN'];
  const received = req.header(SERVICE_TOKEN_HEADER);

  if (!expected || !received || !timingSafeEqual(digest(received), digest(expected))) {
    next(AppError.unauthorized('Token de serviço inválido'));
    return;
  }
  next();
}
