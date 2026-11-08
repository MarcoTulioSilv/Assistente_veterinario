import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Page } from '@playwright/test';

/**
 * O login real depende do AuthService (ms-identity) com um tenant já
 * seedado no Postgres -- fora do escopo do que estes testes de UI
 * precisam validar. Em vez disso, injeta um JWT válido direto no
 * sessionStorage antes da navegação (mesma claim shape exigida por
 * authMiddleware: `sub`/`tid`, ver packages/shared-middlewares/src/auth.ts).
 * Sem refreshToken: desde a auditoria de 06/11/2026 ele vive só no cookie
 * HttpOnly qe_refresh, que estes testes de UI não precisam simular.
 *
 * tenantId aleatório a cada chamada: RLS isola por tenant, então cada
 * teste (ou `test.describe`) que chama isto ganha um tenant "vazio"
 * só seu -- sem necessidade de limpar dados entre testes.
 */
export async function loginAs(
  page: Page,
  overrides?: { tenantId?: string; userId?: string },
): Promise<{ tenantId: string; userId: string }> {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error(
      'JWT_SECRET ausente no ambiente dos testes e2e -- confira se existe .env na raiz do monorepo',
    );
  }

  const tenantId = overrides?.tenantId ?? randomUUID();
  const userId = overrides?.userId ?? randomUUID();

  const token = await new SignJWT({ sub: userId, tid: tenantId, role: 'admin', plan: 'basic' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(secret));

  await page.addInitScript((accessToken) => {
    window.sessionStorage.setItem('accessToken', accessToken);
  }, token);

  return { tenantId, userId };
}
