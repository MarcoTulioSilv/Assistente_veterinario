import type { Request, Response, NextFunction } from 'express';
import type { ApiError } from '@quironequine/shared-types';
import { AppError } from './errors';
import { logger } from './logger';

/**
 * Handler de erro final. Sanitiza a resposta em produção —
 * nunca expõe stack trace ao cliente (Plano de Trabalho §8).
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const traceId = req.traceId;

  if (err instanceof AppError) {
    logger.warn({ traceId, code: err.code, msg: err.message }, 'AppError');
    const body: ApiError = {
      code: err.code,
      message: err.message,
      traceId,
      ...(err.details ? { errors: err.details } : {}),
    };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error({ traceId, err }, 'Erro não tratado');
  const body: ApiError = {
    code: 'INTERNAL_ERROR',
    message: 'Erro interno do servidor',
    traceId,
  };
  res.status(500).json(body);
}

/** 404 para rotas inexistentes */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    code: 'NOT_FOUND',
    message: `Rota ${req.method} ${req.path} não encontrada`,
    traceId: req.traceId,
  };
  res.status(404).json(body);
}
