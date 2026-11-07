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
  Appointment,
  AppointmentStatus,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  FinancialRecord,
  FinancialSourceType,
  GeoPoint,
  RouteDistance,
  Vaccination,
  CreateVaccinationDto,
  VaccineBooster,
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

function buildHeaders(init?: RequestInit): HeadersInit {
  const token = getToken();
  // FormData (upload de arquivo) precisa que o browser defina Content-Type
  // sozinho (com o boundary do multipart) — setar manualmente quebra o parse.
  const isFormData = init?.body instanceof FormData;
  return {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init?.headers,
  };
}

async function throwForErrorResponse(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({
    code: 'INTERNAL_ERROR',
    message: 'Erro de comunicação com o servidor',
  }))) as ApiError;
  throw new ApiClientError(res.status, body);
}

function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return Promise.resolve(undefined as T);
  return res.json() as Promise<T>;
}

// 401 nessas rotas é a própria autenticação falhando (senha errada, refresh
// token vencido/roubado, token de logout inválido) -- tentar renovar aí
// entraria em laço. As demais rotas tratam 401 como "access token venceu".
const SKIP_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshing: Promise<boolean> | null = null;

/**
 * Renova o par de tokens. Uma renovação por vez: se cinco chamadas voltarem
 * 401 juntas (ex: dashboard disparando várias de uma vez), todas esperam a
 * MESMA Promise -- sem isso, cada uma tentaria renovar sozinha e as
 * seguintes cairiam com um refresh token que a primeira já tinha invalidado
 * (auditoria de 06/11/2026, pedidos-para-joao.md). Se o fetch rejeitar (sem
 * rede), a rejeição propaga e quem chamou NÃO limpa a sessão.
 */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = sessionStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    setSession(await res.json());
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(init) });

  if (res.status === 401 && !SKIP_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryRes = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(init) });
      if (!retryRes.ok) await throwForErrorResponse(retryRes);
      return parseResponse<T>(retryRes);
    }
    // Refresh recusado de verdade (não por falta de rede, ver acima): sessão
    // vencida/roubada. Limpa e deixa o 401 original propagar -- cada tela já
    // trata ApiClientError 401 mandando pro /login.
    clearSession();
  }

  if (!res.ok) await throwForErrorResponse(res);
  return parseResponse<T>(res);
}

/** Cliente tipado do BFF — Dev 2 é o dono */
export const api = {
  auth: {
    login: (email: string, password: string, totpCode?: string) =>
      request<AuthTokens>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totpCode }),
      }),
    refresh: (refreshToken: string) =>
      request<AuthTokens>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    /** Sempre 204 (ver AuthService.logout) -- não precisa tratar erro. */
    logout: (refreshToken: string) =>
      request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
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
  appointments: {
    list: (params?: { page?: number; limit?: number; animalId?: string; status?: AppointmentStatus }) =>
      request<Paginated<Appointment>>(`/appointments?${buildQuery(params)}`),
    get: (id: string) => request<Appointment>(`/appointments/${id}`),
    create: (data: CreateAppointmentDto) =>
      request<Appointment>('/appointments', { method: 'POST', body: JSON.stringify(data) }),
    /** Só vale em status: 'draft' (RF-ATD-006) — o orçamento congela ao finalizar. */
    update: (id: string, data: UpdateAppointmentDto) =>
      request<Appointment>(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** RF-ATD-008: congela o orçamento, publica appointment.done. Irreversível. */
    finish: (id: string) => request<Appointment>(`/appointments/${id}/finish`, { method: 'POST' }),
    remove: (id: string) => request<void>(`/appointments/${id}`, { method: 'DELETE' }),
  },
  financial: {
    // 404 (sem pendência pra essa origem) é um estado válido, não um erro —
    // vira null em vez de propagar o ApiClientError.
    findBySource: async (sourceType: FinancialSourceType, sourceId: string) => {
      try {
        return await request<FinancialRecord>(`/financial/by-source/${sourceType}/${sourceId}`);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) return null;
        throw err;
      }
    },
  },
  geo: {
    // 503 (rota indisponível agora -- API fora, sem key, sem rota de carro)
    // é um estado válido, não um erro: a tela volta a pedir o km à mão.
    route: async (origin: GeoPoint, destination: GeoPoint) => {
      const params = {
        originLat: origin.latitude,
        originLng: origin.longitude,
        destinationLat: destination.latitude,
        destinationLng: destination.longitude,
      };
      try {
        return await request<RouteDistance>(`/geo/route?${buildQuery(params)}`);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 503) return null;
        throw err;
      }
    },
  },
  vaccinations: {
    list: (params?: { page?: number; limit?: number; animalId?: string }) =>
      request<Paginated<Vaccination>>(`/vaccinations?${buildQuery(params)}`),
    get: (id: string) => request<Vaccination>(`/vaccinations/${id}`),
    boosters: (animalId: string) => request<VaccineBooster[]>(`/vaccinations/boosters/${animalId}`),
    create: (data: CreateVaccinationDto) =>
      request<Vaccination>('/vaccinations', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/vaccinations/${id}`, { method: 'DELETE' }),
  },
};
