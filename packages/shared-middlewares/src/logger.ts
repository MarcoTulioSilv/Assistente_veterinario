import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

/**
 * Logger estruturado JSON.
 * Regra do Plano de Trabalho §8: proibido console.log em produção.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }
    : {}),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      '*.password',
      '*.apiKey',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

export function createServiceLogger(serviceName: string): pino.Logger {
  return logger.child({ service: serviceName });
}
