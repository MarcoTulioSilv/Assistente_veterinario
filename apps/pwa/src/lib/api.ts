import type { ApiError, Paginated, Owner, Property, Animal, AuthTokens } from '@vetequine/shared-types';

const BASE_URL = process.env['NEXT_PUBLIC_BFF_URL'] ?? 'http://localhost:3000/api/v1';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('accessToken');
}

/** Persiste os tokens da sessão após login — chamado pela tela de login */
export function setSession(tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>): void {
  sessionStorage.setItem('accessToken', tokens.accessToken);
  sessionStorage.setItem('refreshToken', tokens.refreshToken);
}

export function clearSession(): void {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('refreshToken');
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      code: 'INTERNAL_ERROR',
      message: 'Erro de comunicação com o servidor',
    }))) as ApiError;
    throw new ApiClientError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Cliente tipado do BFF — Dev 2 é o dono */
export const api = {
  auth: {
    login: (email: string, password: string, totpCode?: string) =>
      request<AuthTokens>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totpCode }),
      }),
  },
  owners: {
    list: (params?: { page?: number; search?: string }) =>
      request<Paginated<Owner>>(`/owners?${new URLSearchParams(params as never)}`),
    get: (id: string) => request<Owner>(`/owners/${id}`),
    create: (data: unknown) =>
      request<Owner>('/owners', { method: 'POST', body: JSON.stringify(data) }),
  },
  properties: {
    list: (params?: { page?: number; ownerId?: string }) =>
      request<Paginated<Property>>(`/properties?${new URLSearchParams(params as never)}`),
  },
  animals: {
    list: (params?: { page?: number; propertyId?: string }) =>
      request<Paginated<Animal>>(`/animals?${new URLSearchParams(params as never)}`),
    transfer: (id: string, toPropertyId: string) =>
      request<Animal>(`/animals/${id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ toPropertyId }),
      }),
  },
};
