import { Router } from 'express';
import { prisma } from '../prisma';

export const healthRouter = Router();

/** Liveness — o processo está vivo? */
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-clinical', timestamp: new Date().toISOString() });
});

/** Readiness — as dependências estão prontas? */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});
