import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '@vetequine/shared-middlewares';

type Source = 'body' | 'query' | 'params';

/** Middleware genérico de validação Zod */
export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      next(AppError.validation('Erro de validação nos campos enviados', details));
      return;
    }
    req[source] = result.data;
    next();
  };
}
