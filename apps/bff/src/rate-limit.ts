import type { Express } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Limites de requisição (RNF-SEG-001) — auditoria de 06/11/2026, A-02.
 *
 * Em staging e produção o BFF fica atrás do Caddy: sem `trust proxy`, todo
 * mundo chegava com o IP do Caddy e o limite "por IP" virava um limite do
 * sistema inteiro — dois ou três veterinários ativos já recebiam 429, e um
 * só cliente derrubava os outros. `TRUST_PROXY` diz quantos proxies
 * confiáveis há na frente (1 = o Caddy, que descarta o X-Forwarded-For
 * vindo de fora e grava o IP real). Local, sem proxy, fica 0: aceitar o
 * cabeçalho ali deixaria qualquer um escolher o próprio IP.
 */
export interface RateLimitConfig {
  trustProxy: number;
  windowMs: number;
  maxPerIp: number;
  /** Tentativas de login que FALHARAM, por IP, a cada 15 minutos. */
  loginFailuresPer15Min: number;
  /** Renovações de sessão por IP por minuto (uma clínica inteira atrás do mesmo NAT). */
  refreshPerMinute: number;
  /** Cadastros de clínica por IP por hora. */
  signupsPerHour: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} inválido: "${raw}"`);
  return value;
}

export function rateLimitConfigFromEnv(): RateLimitConfig {
  return {
    trustProxy: envNumber('TRUST_PROXY', 0),
    windowMs: envNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    maxPerIp: envNumber('RATE_LIMIT_MAX_PER_IP', 100),
    loginFailuresPer15Min: envNumber('RATE_LIMIT_LOGIN_FAILURES', 10),
    refreshPerMinute: envNumber('RATE_LIMIT_REFRESH_PER_MIN', 30),
    signupsPerHour: envNumber('RATE_LIMIT_SIGNUPS_PER_HOUR', 5),
  };
}

const TOO_MANY = { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde um momento.' };

/** Aplica `trust proxy` e os limites. Chamar antes das rotas e do proxy. */
export function applyRateLimits(app: Express, config: RateLimitConfig): void {
  app.set('trust proxy', config.trustProxy);

  const common = { standardHeaders: true, legacyHeaders: false, message: TOO_MANY } as const;

  // Rotas de autenticação: limites próprios, mais apertados que o geral.
  app.post(
    '/api/v1/auth/login',
    rateLimit({
      ...common,
      windowMs: 15 * 60_000,
      max: config.loginFailuresPer15Min,
      // Só falha conta: quem acerta a senha não gasta a cota de ninguém.
      skipSuccessfulRequests: true,
      message: { code: 'RATE_LIMITED', message: 'Muitas tentativas de login. Aguarde alguns minutos.' },
    }),
  );
  app.post('/api/v1/auth/refresh', rateLimit({ ...common, windowMs: 60_000, max: config.refreshPerMinute }));
  app.post('/api/v1/tenants', rateLimit({ ...common, windowMs: 60 * 60_000, max: config.signupsPerHour }));

  app.use(rateLimit({ ...common, windowMs: config.windowMs, max: config.maxPerIp }));
}
