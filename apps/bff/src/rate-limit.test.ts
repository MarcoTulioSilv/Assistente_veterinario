import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { applyRateLimits, rateLimitConfigFromEnv, type RateLimitConfig } from './rate-limit';

const BASE: RateLimitConfig = {
  trustProxy: 1,
  windowMs: 60_000,
  maxPerIp: 3,
  loginFailuresPer15Min: 2,
  refreshPerMinute: 2,
  signupsPerHour: 1,
};

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Sobe um app só com os limites e rotas de mentira; devolve um `call` que simula o IP do cliente. */
async function start(config: RateLimitConfig) {
  const app = express();
  applyRateLimits(app, config);
  app.get('/api/v1/owners', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/login', (req, res) => {
    res.status(req.headers['x-senha'] === 'certa' ? 200 : 401).json({});
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server!.address() as AddressInfo;

  return (path: string, ip: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      // O que o Caddy grava: o IP real do cliente.
      headers: { 'x-forwarded-for': ip, ...(init.headers as Record<string, string>) },
    }).then((r) => r.status);
}

describe('limites por IP atrás do Caddy (auditoria A-02)', () => {
  it('cada cliente tem a sua cota — um não esgota a do outro', async () => {
    const call = await start(BASE);

    for (let i = 0; i < 3; i++) expect(await call('/api/v1/owners', '200.1.1.1')).toBe(200);
    expect(await call('/api/v1/owners', '200.1.1.1')).toBe(429);

    // Antes da correção, este seria 429: todo mundo tinha o IP do Caddy.
    expect(await call('/api/v1/owners', '200.2.2.2')).toBe(200);
  });

  it('sem trust proxy (desenvolvimento local), o cabeçalho é ignorado: não dá pra escolher o próprio IP', async () => {
    const call = await start({ ...BASE, trustProxy: 0 });

    for (let i = 0; i < 3; i++) expect(await call('/api/v1/owners', `10.0.0.${i}`)).toBe(200);
    expect(await call('/api/v1/owners', '10.0.0.99')).toBe(429);
  });

  it('login: só as tentativas que falharam contam', async () => {
    const call = await start({ ...BASE, maxPerIp: 100 });
    const senha = (s: string) => ({ method: 'POST', headers: { 'x-senha': s } });

    expect(await call('/api/v1/auth/login', '200.3.3.3', senha('certa'))).toBe(200);
    expect(await call('/api/v1/auth/login', '200.3.3.3', senha('certa'))).toBe(200);
    expect(await call('/api/v1/auth/login', '200.3.3.3', senha('errada'))).toBe(401);
    expect(await call('/api/v1/auth/login', '200.3.3.3', senha('errada'))).toBe(401);
    expect(await call('/api/v1/auth/login', '200.3.3.3', senha('certa'))).toBe(429);
    expect(await call('/api/v1/auth/login', '200.4.4.4', senha('certa'))).toBe(200);
  });
});

describe('rateLimitConfigFromEnv', () => {
  it('padrão sem proxy confiável, e recusa valor inválido em vez de seguir sem limite', () => {
    delete process.env['TRUST_PROXY'];
    expect(rateLimitConfigFromEnv().trustProxy).toBe(0);

    process.env['TRUST_PROXY'] = 'sim';
    try {
      expect(() => rateLimitConfigFromEnv()).toThrow(/TRUST_PROXY/);
    } finally {
      delete process.env['TRUST_PROXY'];
    }
  });
});
