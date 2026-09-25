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

  // Rotas protegidas — exigem JWT válido.
  // As rotas de atendimento/prescrição entram aqui (Dev 2, Sprint 5):
  // o AppointmentService e o AppointmentRepository já estão prontos.
  app.use(authMiddleware);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
