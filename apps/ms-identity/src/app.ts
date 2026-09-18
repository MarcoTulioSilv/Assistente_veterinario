import path from 'node:path';
import express, { type Express } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
} from '@quironequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';
import { authRouter } from './controllers/auth.controller';
import { ownerRouter } from './controllers/owner.controller';
import { tenantRegisterRouter, tenantRouter } from './controllers/tenant.controller';
import { propertyRouter } from './controllers/property.controller';
import { animalRouter } from './controllers/animal.controller';
import { uploadRouter } from './controllers/upload.controller';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/tenants', tenantRegisterRouter); // só POST / (cadastro) — GET/PATCH /me ficam protegidos abaixo
  // Leitura de arquivo (GET) é pública — uma <img src> não manda Authorization.
  // Escrita (POST, uploadRouter abaixo) continua protegida.
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Rotas protegidas — exigem JWT válido
  app.use(authMiddleware);
  app.use('/owners', ownerRouter);
  app.use('/tenants', tenantRouter); // GET/PATCH /me
  app.use('/properties', propertyRouter);
  app.use('/animals', animalRouter);
  app.use('/uploads', uploadRouter); // POST /

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
