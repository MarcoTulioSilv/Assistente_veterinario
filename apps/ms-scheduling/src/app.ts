import express, { type Express } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
} from '@quironequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);

  // Rotas protegidas — exigem JWT válido. O router da agenda (`/schedule`,
  // controllers e schemas Zod) é do Dev 2 e entra aqui.
  app.use(authMiddleware);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
