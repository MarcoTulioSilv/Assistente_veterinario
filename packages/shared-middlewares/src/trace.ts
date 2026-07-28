import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare module 'express-serve-static-core' {
  interface Request {
    traceId: string;
  }
}

/**
 * Gera ou propaga o trace_id.
 * ADR-001 §6.2: trace_id atravessa BFF → microsserviço → logs.
 */
export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-trace-id');
  req.traceId = incoming ?? randomUUID();
  res.setHeader('x-trace-id', req.traceId);
  next();
}
