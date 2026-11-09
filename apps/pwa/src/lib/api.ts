import type {
  ApiError,
  Paginated,
  Owner,
  Property,
  Animal,
  Product,
  ProductCategory,
  StockMovement,
  AuthSession,
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

// Mesmo nome de API_CACHE em public/sw.js (VERSION) — os dois não podem
// importar um do outro (um é worker, o outro é módulo TS do client), então
// o nome fica duplicado aqui de propósito. Atualize os dois juntos.
const API_CACHE_NAME = 'quironequine-api-v2';

/**
 * Limpa o cache de respostas da API no Cache Storage (auditoria A-01): sem
 * isso, um aparelho compartilhado mostra, offline, dados do usuário anterior
 * (nome, CPF, telefone de outra clínica). Chamado no login (antes da sessão
 * nova) e dentro de clearSession() (logout e falha de refresh) -- nunca a
 * cada renovação normal de token, que é o mesmo usuário continuando.
 */
export async function clearApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(API_CACHE_NAME).catch(() => undefined);
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('accessToken');
}

/**
 * Persiste a sessão após login/renovação. O refresh token nunca passa por
 * aqui -- desde a auditoria de 06/11/2026, ele vive só no cookie HttpOnly
 * `qe_refresh` (Path=/api/v1/auth), que este módulo não lê nem escreve.
 */
export function setSession(session: Pick<AuthSession, 'accessToken'>): void {
  sessionStorage.setItem('accessToken', session.accessToken);
}

export function clearSession(): void {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('refreshToken'); // limpa resíduo de sessões antigas (pré-cookie)
  void clearApiCache();
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
 * Renova a sessão. Uma renovação por vez: se cinco chamadas voltarem 401
 * juntas (ex: dashboard disparando várias de uma vez), todas esperam a
 * MESMA Promise -- sem isso, cada uma tentaria renovar sozinha e as
 * seguintes cairiam com um refresh token que a primeira já tinha invalidado
 * (auditoria de 06/11/2026, pedidos-para-joao.md). Se o fetch rejeitar (sem
 * rede), a rejeição propaga e quem chamou NÃO limpa a sessão.
 *
 * Sem corpo e sem ler o sessionStorage: o refresh token vai só no cookie
 * HttpOnly `qe_refresh`, que o navegador manda sozinho com `credentials:
 * 'include'` -- este módulo nunca tem acesso a ele.
 */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
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
    // credentials: 'include' nas três -- sem isso o navegador descarta o
    // Set-Cookie do login (origem diferente) e não manda o cookie no
    // refresh/logout. O resto da API não usa credentials: 'include' (o
    // cookie nem viaja, por causa do Path=/api/v1/auth do cookie).
    login: (email: string, password: string, totpCode?: string) =>
      request<AuthSession>('/auth/login', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email, password, totpCode }),
      }),
    /** Sempre 204 (ver AuthService.logout) -- não precisa tratar erro. */
    logout: () => request<void>('/auth/logout', { method: 'POST', credentials: 'include' }),
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
    // 404 (CEP não encontrado) é um estado válido, não um erro -- a tela
    // mostra a mensagem ao lado do campo e deixa o mapa como estava.
    geocodeZip: async (zipCode: string) => {
      try {
        return await request<GeoPoint>(`/geo/geocode?${buildQuery({ zipCode })}`);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) return null;
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
