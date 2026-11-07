import type { AuthTokens } from '@quironequine/shared-types';
import { api, ApiClientError, setSession } from './api';
import { mockLogin } from './mock-auth';

/**
 * MS1 POST /auth/login ainda retorna 501 (AuthService é Sprint 2 do Dev 1 —
 * ver apps/ms-identity/src/controllers/auth.controller.ts). Tenta o endpoint
 * real primeiro; se vier 501, cai para o mock local. Quando o AuthService for
 * entregue o fallback simplesmente para de disparar — nenhuma tela muda
 * (ONBOARDING.md §9, "contrato entre os dois").
 */
export async function login(
  email: string,
  password: string,
  totpCode?: string,
): Promise<AuthTokens> {
  try {
    const tokens = await api.auth.login(email, password, totpCode);
    setSession(tokens);
    return tokens;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 501) {
      const tokens = await mockLogin(email, password);
      setSession(tokens);
      return tokens;
    }
    throw err;
  }
}
