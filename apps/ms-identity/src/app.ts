import express, { type Express } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
} from '@vetequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';
import { authRouter } from './controllers/auth.controller';
import { ownerRouter } from './controllers/owner.controller';
import { tenantRegisterRouter, tenantRouter } from './controllers/tenant.controller';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/tenants', tenantRegisterRouter); // só POST / (cadastro) — GET/PATCH /me ficam protegidos abaixo

  // Rotas protegidas — exigem JWT válido
  app.use(authMiddleware);
  app.use('/owners', ownerRouter);
  app.use('/tenants', tenantRouter); // GET/PATCH /me

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
