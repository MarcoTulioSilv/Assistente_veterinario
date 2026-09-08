import express, { type Express } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
} from '@vetequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';
import { productRouter } from './controllers/product.controller';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);

  // Rotas protegidas — exigem JWT válido
  app.use(authMiddleware);
  app.use('/products', productRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
