import type { AuthSession } from '@quironequine/shared-types';
import { api, ApiClientError, clearApiCache, setSession } from './api';
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
): Promise<AuthSession> {
  // Limpa o cache de API de uma sessão anterior ANTES de logar -- cobre o
  // caso de alguém sair sem usar "Sair" num aparelho compartilhado (auditoria
  // A-01): sem isso, o próximo login ainda vê os dados do usuário anterior
  // offline.
  await clearApiCache();
  try {
    const session = await api.auth.login(email, password, totpCode);
    setSession(session);
    return session;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 501) {
      const session = await mockLogin(email, password);
      setSession(session);
      return session;
    }
    throw err;
  }
}
