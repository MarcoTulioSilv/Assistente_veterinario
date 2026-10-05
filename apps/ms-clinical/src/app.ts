import express, { type Express } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
} from '@quironequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';
import { appointmentRouter } from './controllers/appointment.controller';
import { examTypeRouter } from './controllers/exam-type.controller';
import { examRouter } from './controllers/exam.controller';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);

  // Rotas protegidas — exigem JWT válido.
  app.use(authMiddleware);
  app.use('/appointments', appointmentRouter);
  app.use('/exam-types', examTypeRouter);
  app.use('/exams', examRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
