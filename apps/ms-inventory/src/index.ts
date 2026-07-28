import express from 'express';
import {
  traceMiddleware,
  authMiddleware,
  errorHandler,
  notFoundHandler,
  createServiceLogger,
} from '@vetequine/shared-middlewares';

const log = createServiceLogger('ms-inventory');
const PORT = Number(process.env['PORT_MS_INVENTORY'] ?? 3002);
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(traceMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ms-inventory', timestamp: new Date().toISOString() });
});

app.use(authMiddleware);

// TODO Sprint 3 — Dev 2 implementa os controllers
// app.use('/products', productRouter);
// app.use('/alerts', alertRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => log.info({ port: PORT }, 'MS2 Inventory iniciado'));
