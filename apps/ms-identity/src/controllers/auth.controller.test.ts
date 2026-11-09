import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { AuthTokens, IAuthService } from '@quironequine/shared-types';
import { AppError, errorHandler } from '@quironequine/shared-middlewares';

// O módulo instancia o AuthService real no topo; sem banco nos testes de controller.
vi.mock('../repositories/auth.repository', () => ({ AuthRepository: class {} }));

const { createAuthRouter } = await import('./auth.controller');
const { readRefreshCookie } = await import('../lib/refresh-cookie');

function tokens(refreshToken: string): AuthTokens {
  return {
    accessToken: 'access',
    refreshToken,
    expiresIn: 900,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'vet@exemplo.com',
      fullName: 'Vet',
      role: 'admin',
      sketchUrl: null,
      status: 'active',
      propertyId: null,
      ownerId: null,
      createdAt: '2026-11-07T00:00:00.000Z',
    },
  };
}

function fakeService(): IAuthService & {
  login: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
} {
  return {
    login: vi.fn().mockResolvedValue(tokens('sess1.segredo1')),
    refresh: vi.fn().mockResolvedValue(tokens('sess1.segredo2')),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(service: IAuthService) {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter(service));
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server!.address() as AddressInfo;
  return (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    });
}

describe('auth.controller — refresh token só em cookie HttpOnly', () => {
  it('login grava o cookie com os atributos de segurança e não devolve o refresh no corpo', async () => {
    const call = await start(fakeService());
    const res = await call('/auth/login', {
      body: JSON.stringify({ email: 'vet@exemplo.com', password: 'senha-forte' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('refreshToken');
    expect(body['accessToken']).toBe('access');

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^qe_refresh=sess1\.segredo1;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('Max-Age=604800'); // 7 dias, o padrão de JWT_REFRESH_EXPIRES_IN
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('refresh lê o token do cookie, ignora o corpo e grava o par novo', async () => {
    const service = fakeService();
    const call = await start(service);
    const res = await call('/auth/refresh', {
      headers: { cookie: 'outro=1; qe_refresh=sess1.segredo1' },
      body: JSON.stringify({ refreshToken: 'do-corpo' }),
    });

    expect(res.status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith('sess1.segredo1');
    expect(await res.json()).not.toHaveProperty('refreshToken');
    expect(res.headers.get('set-cookie')).toMatch(/^qe_refresh=sess1\.segredo2;/);
  });

  it('refresh sem cookie: 401 sem chamar o serviço, mesmo com refreshToken no corpo', async () => {
    const service = fakeService();
    const call = await start(service);
    const res = await call('/auth/refresh', { body: JSON.stringify({ refreshToken: 'x.y' }) });

    expect(res.status).toBe(401);
    expect(service.refresh).not.toHaveBeenCalled();
  });

  it('refresh recusado pelo serviço apaga o cookie', async () => {
    const service = fakeService();
    service.refresh.mockRejectedValue(
      AppError.unauthorized('Sessão encerrada por segurança. Entre de novo.'),
    );
    const call = await start(service);
    const res = await call('/auth/refresh', { headers: { cookie: 'qe_refresh=sess1.velho' } });

    expect(res.status).toBe(401);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^qe_refresh=;/);
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('logout revoga a sessão do cookie, apaga o cookie e responde 204', async () => {
    const service = fakeService();
    const call = await start(service);
    const res = await call('/auth/logout', { headers: { cookie: 'qe_refresh=sess1.segredo1' } });

    expect(res.status).toBe(204);
    expect(service.logout).toHaveBeenCalledWith('sess1.segredo1');
    expect(res.headers.get('set-cookie')).toMatch(/^qe_refresh=;/);
  });

  it('logout sem cookie também responde 204, sem chamar o serviço', async () => {
    const service = fakeService();
    const call = await start(service);
    const res = await call('/auth/logout');

    expect(res.status).toBe(204);
    expect(service.logout).not.toHaveBeenCalled();
  });
});

describe('readRefreshCookie', () => {
  const req = (cookie?: string) =>
    ({ headers: { cookie } }) as Parameters<typeof readRefreshCookie>[0];

  it('acha o cookie entre outros e decodifica', () => {
    expect(readRefreshCookie(req('a=1; qe_refresh=abc%2Edef; b=2'))).toBe('abc.def');
  });

  it('ausente, vazio, nome parecido ou codificação quebrada → undefined', () => {
    expect(readRefreshCookie(req())).toBeUndefined();
    expect(readRefreshCookie(req('qe_refresh='))).toBeUndefined();
    expect(readRefreshCookie(req('xqe_refresh=abc'))).toBeUndefined();
    expect(readRefreshCookie(req('qe_refresh=%E0%A4%A'))).toBeUndefined();
  });
});
