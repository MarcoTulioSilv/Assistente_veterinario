import type {
  ApiError,
  Paginated,
  Owner,
  Property,
  Animal,
  Product,
  ProductCategory,
  StockMovement,
  AuthTokens,
  TenantProfile,
  UpdateVeterinarianDto,
  CreateOwnerDto,
  UpdateOwnerDto,
  CreatePropertyDto,
  UpdatePropertyDto,
  CreateAnimalDto,
  UpdateAnimalDto,
  CreateProductDto,
  UpdateProductDto,
  CreateMovementDto,
} from '@quironequine/shared-types';

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

/** Usado por telas protegidas para redirecionar a /login sem sessão. */
export function hasSession(): boolean {
  return getToken() !== null;
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

function buildQuery(params?: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  // FormData (upload de arquivo) precisa que o browser defina Content-Type
  // sozinho (com o boundary do multipart) — setar manualmente quebra o parse.
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
    list: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: 'pending' | 'active' | 'all';
    }) => request<Paginated<Owner>>(`/owners?${buildQuery(params)}`),
    get: (id: string) => request<Owner>(`/owners/${id}`),
    create: (data: CreateOwnerDto) =>
      request<Owner>('/owners', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: UpdateOwnerDto) =>
      request<Owner>(`/owners/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/owners/${id}`, { method: 'DELETE' }),
  },
  properties: {
    list: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: 'pending' | 'active' | 'all';
      ownerId?: string;
    }) => request<Paginated<Property>>(`/properties?${buildQuery(params)}`),
    get: (id: string) => request<Property>(`/properties/${id}`),
    create: (data: CreatePropertyDto) =>
      request<Property>('/properties', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: UpdatePropertyDto) =>
      request<Property>(`/properties/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/properties/${id}`, { method: 'DELETE' }),
  },
  animals: {
    list: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: 'pending' | 'active' | 'all';
      propertyId?: string;
    }) => request<Paginated<Animal>>(`/animals?${buildQuery(params)}`),
    get: (id: string) => request<Animal>(`/animals/${id}`),
    create: (data: CreateAnimalDto) =>
      request<Animal>('/animals', { method: 'POST', body: JSON.stringify(data) }),
    // propertyId de propósito fora daqui: mudar de propriedade só via transfer(),
    // que gera o log de animal_transfers (RN-010) -- update() não loga nada.
    update: (id: string, data: Omit<UpdateAnimalDto, 'propertyId'>) =>
      request<Animal>(`/animals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/animals/${id}`, { method: 'DELETE' }),
    transfer: (id: string, toPropertyId: string, notes?: string) =>
      request<Animal>(`/animals/${id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ toPropertyId, notes }),
      }),
  },
  products: {
    list: (params?: { page?: number; limit?: number; search?: string; category?: ProductCategory }) =>
      request<Paginated<Product>>(`/products?${buildQuery(params)}`),
    get: (id: string) => request<Product>(`/products/${id}`),
    create: (data: CreateProductDto) =>
      request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: UpdateProductDto) =>
      request<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/products/${id}`, { method: 'DELETE' }),
    listMovements: (id: string, params?: { page?: number; limit?: number }) =>
      request<{ data: StockMovement[]; total: number }>(
        `/products/${id}/movements?${buildQuery(params)}`,
      ),
    recordMovement: (id: string, data: CreateMovementDto) =>
      request<StockMovement>(`/products/${id}/movements`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  tenants: {
    getMe: () => request<TenantProfile>('/tenants/me'),
    updateMe: (data: UpdateVeterinarianDto) =>
      request<TenantProfile>('/tenants/me', { method: 'PATCH', body: JSON.stringify(data) }),
  },
  uploads: {
    upload: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<{ url: string }>('/uploads', { method: 'POST', body: formData });
    },
  },
};
