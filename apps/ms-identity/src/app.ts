import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
  AppError,
  verifyUploadSignature,
} from '@quironequine/shared-middlewares';
import { healthRouter } from './controllers/health.controller';
import { authRouter } from './controllers/auth.controller';
import { ownerRouter } from './controllers/owner.controller';
import { tenantRegisterRouter, tenantRouter } from './controllers/tenant.controller';
import { propertyRouter } from './controllers/property.controller';
import { animalRouter } from './controllers/animal.controller';
import { uploadRouter } from './controllers/upload.controller';
import { geoRouter } from './controllers/geo.controller';

/** `<tenantId>/<pasta>/<arquivo>`, sem nada que suba de diretório. */
const UPLOAD_KEY_RE = /^[0-9a-f-]{36}\/[a-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/i;

function requireSignedUpload(req: Request, res: Response, next: NextFunction): void {
  // POST (envio) segue para o uploadRouter, protegido pelo JWT.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const key = req.path.slice(1);
  if (!UPLOAD_KEY_RE.test(key) || !verifyUploadSignature(key, req.query['exp'], req.query['sig'])) {
    next(AppError.notFound('Arquivo não encontrado'));
    return;
  }
  // A URL é temporária: o navegador pode reaproveitar só enquanto ela vale,
  // e nenhum cache compartilhado (proxy, CDN) guarda.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(traceMiddleware);

  // Rotas públicas
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/tenants', tenantRegisterRouter); // só POST / (cadastro) — GET/PATCH /me ficam protegidos abaixo
  // Leitura de arquivo (GET): uma <img src> não manda Authorization, então
  // a prova é a URL assinada que a API devolveu (auditoria M-03). Sem
  // assinatura válida e no prazo, 404 — igual a arquivo inexistente.
  // Escrita (POST, uploadRouter abaixo) continua exigindo o JWT.
  app.use('/uploads', requireSignedUpload, express.static(path.join(__dirname, '../uploads'), { index: false }));

  // Rotas protegidas — exigem JWT válido
  app.use(authMiddleware);
  app.use('/owners', ownerRouter);
  app.use('/tenants', tenantRouter); // GET/PATCH /me
  app.use('/properties', propertyRouter);
  app.use('/animals', animalRouter);
  app.use('/uploads', uploadRouter); // POST /
  app.use('/geo', geoRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
