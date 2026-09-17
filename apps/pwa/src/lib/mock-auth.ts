import type { AuthTokens } from '@quironequine/shared-types';
import { ApiClientError } from './api';

/**
 * Mock de IAuthService (packages/shared-types) — MS1 /auth/login retorna 501
 * até o Dev 1 entregar o AuthService real (ONBOARDING.md §9, "contrato entre
 * os dois"). Troca prevista: substituir mockLogin por api.auth.login na tela
 * de login quando o endpoint real estiver pronto.
 */

const MOCK_CREDENTIALS = { email: 'dev@quironequine.com.br', password: 'senha123' };

const MOCK_TOKENS: AuthTokens = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  expiresIn: 3600,
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: MOCK_CREDENTIALS.email,
    fullName: 'Usuário de Teste',
    role: 'admin',
    plan: 'plus',
    tenantId: '00000000-0000-0000-0000-000000000010',
  },
};

const MOCK_LATENCY_MS = 600;

export async function mockLogin(email: string, password: string): Promise<AuthTokens> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

  if (email === MOCK_CREDENTIALS.email && password === MOCK_CREDENTIALS.password) {
    return MOCK_TOKENS;
  }

  throw new ApiClientError(401, {
    code: 'UNAUTHORIZED',
    message: 'E-mail ou senha inválidos',
  });
}

/**
 * "Esqueci minha senha" ainda não tem contrato em IAuthService nem rota no
 * MS1 (diferente do login, que já tem os dois) — 100% mock local até o Dev 1
 * publicar a interface. Nunca revela se o e-mail existe (evita enumeração de
 * usuários), então sempre resolve com sucesso após a latência simulada.
 */
export async function mockRequestPasswordReset(_email: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
}
