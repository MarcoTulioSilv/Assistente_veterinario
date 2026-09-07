import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import {
  traceMiddleware,
  errorHandler,
  notFoundHandler,
  createServiceLogger,
} from '@vetequine/shared-middlewares';

const log = createServiceLogger('bff');
const PORT = Number(process.env['PORT_BFF'] ?? 3000);
const app = express();

// ─── Segurança (Plano de Trabalho §8) ────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3100',
    credentials: true,
  }),
);
app.use(traceMiddleware);

// ─── Rate limiting (RNF-SEG-001) ─────────────────────────────────
app.use(
  rateLimit({
    windowMs: Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 60_000),
    max: Number(process.env['RATE_LIMIT_MAX_PER_IP'] ?? 100),
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde um momento.' },
  }),
);

// ─── Health checks ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bff', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  const services = {
    identity: process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001',
    inventory: process.env['MS_INVENTORY_URL'] ?? 'http://localhost:3002',
  };

  const results = await Promise.all(
    Object.entries(services).map(async ([name, url]) => {
      const started = Date.now();
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        return [name, { status: r.ok ? 'ok' : 'down', latencyMs: Date.now() - started }];
      } catch {
        return [name, { status: 'down', latencyMs: Date.now() - started }];
      }
    }),
  );

  const map = Object.fromEntries(results);
  const allOk = Object.values(map).every((s) => (s as { status: string }).status === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', services: map });
});

// ─── Proxy para microsserviços (ADR-001 §3) ──────────────────────
const routes: Array<[string, string]> = [
  ['/api/v1/auth', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/owners', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/properties', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/animals', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/tenants', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/uploads', process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001'],
  ['/api/v1/inventory', process.env['MS_INVENTORY_URL'] ?? 'http://localhost:3002'],
];

for (const [path, target] of routes) {
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { [`^${path}`]: path.replace('/api/v1', '') },
      onProxyReq: (proxyReq, req) => {
        // Propaga o trace_id para o microsserviço (ADR-001 §6.2)
        const traceId = (req as express.Request).traceId;
        if (traceId) proxyReq.setHeader('x-trace-id', traceId);
      },
      onError: (err, _req, res) => {
        log.error({ err, target }, 'Falha no proxy');
        (res as express.Response).status(503).json({
          code: 'EXTERNAL_SERVICE_ERROR',
          message: 'Serviço temporariamente indisponível',
        });
      },
    }),
  );
}

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => log.info({ port: PORT }, 'BFF Gateway iniciado'));
