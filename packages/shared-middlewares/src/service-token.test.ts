import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { requireServiceToken, SERVICE_TOKEN_HEADER } from './service-token';
import { AppError } from './errors';

function call(token: string | undefined): unknown {
  const req = { header: (name: string) => (name === SERVICE_TOKEN_HEADER ? token : undefined) } as unknown as Request;
  const next = vi.fn();
  requireServiceToken(req, {} as Response, next);
  return next.mock.calls[0]?.[0];
}

afterEach(() => {
  delete process.env['INTERNAL_SERVICE_TOKEN'];
});

describe('requireServiceToken', () => {
  it('deixa passar com o token certo', () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'segredo-de-servico';
    expect(call('segredo-de-servico')).toBeUndefined();
  });

  it('recusa token errado, de tamanho diferente ou ausente', () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'segredo-de-servico';
    for (const token of ['segredo-de-servicx', 'curto', undefined]) {
      const err = call(token);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
    }
  });

  it('falha fechada: sem a variável configurada, recusa até token vazio', () => {
    expect(call('qualquer')).toBeInstanceOf(AppError);
    expect(call('')).toBeInstanceOf(AppError);
  });
});
