import type { ErrorCode } from '@vetequine/shared-types';

/** Erro de aplicação com código padronizado e status HTTP */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, AppError);
  }

  static unauthorized(message = 'Não autenticado'): AppError {
    return new AppError('UNAUTHORIZED', message, 401);
  }
  static forbidden(message = 'Sem permissão'): AppError {
    return new AppError('FORBIDDEN', message, 403);
  }
  static notFound(message = 'Recurso não encontrado'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }
  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message, 409);
  }
  static planLimit(message: string): AppError {
    return new AppError('PLAN_LIMIT_REACHED', message, 402);
  }
  static validation(
    message: string,
    details?: Array<{ field: string; message: string }>,
  ): AppError {
    return new AppError('VALIDATION_ERROR', message, 422, details);
  }
}
