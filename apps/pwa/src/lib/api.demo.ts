import type {
  ApiError,
  AuthTokens,
  Paginated,
  Owner,
  Property,
  Animal,
  Product,
  ProductCategory,
  StockMovement,
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
import { ApiClientError } from './api-error';
import { DEMO_ANIMALS, DEMO_MOVEMENTS, DEMO_OWNERS, DEMO_PRODUCTS, DEMO_PROPERTIES } from './demo-fixtures';

/**
 * Espelha a forma de `api` em api.ts, mas 100% em memória — usado no build
 * estático pro GitHub Pages (NEXT_PUBLIC_DEMO_MODE=true), que não tem BFF
 * nem banco por trás. list()/get() leem de demo-fixtures.ts.
 *
 * Mutações (create/update/remove/transfer/recordMovement) rejeitam com
 * ApiClientError — mesma forma de erro que o app já trata em toda tela,
 * então o toast de erro aparece normal em vez de a tela quebrar (a demo é
 * só-leitura: não há onde persistir uma escrita sem BFF/banco por trás).
 */

const DEMO_LATENCY_MS = 250;

// Mesmas credenciais do mock-auth.ts (fallback de /auth/login quando MS1
// devolve 501) -- reaproveitadas aqui porque, na demo estática (GitHub
// Pages), não existe BFF pra sequer *tentar* primeiro e cair no 501: um
// fetch() contra um servidor inexistente falha como erro de rede, não como
// ApiClientError(501), então o fallback de lib/auth.ts nunca dispara.
const DEMO_CREDENTIALS = { email: 'dev@quironequine.com.br', password: 'senha123' };

const DEMO_TOKENS: AuthTokens = {
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
  expiresIn: 3600,
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: DEMO_CREDENTIALS.email,
    fullName: 'Usuário Demo',
    role: 'admin',
    plan: 'plus',
    tenantId: '00000000-0000-0000-0000-000000000010',
  },
};

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), DEMO_LATENCY_MS));
}

interface ListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'pending' | 'active' | 'all';
  ownerId?: string;
  propertyId?: string;
  category?: ProductCategory;
}

/** Mesma semântica dos list() reais: busca por nome (case-insensitive), filtro de status/vínculo, paginação. */
function paginate<T extends { status?: string; ownerId?: string | null; propertyId?: string | null; category?: string }>(
  rows: T[],
  nameField: keyof T,
  params: ListFilters | undefined,
): Paginated<T> {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const status = params?.status ?? 'active';

  let filtered = rows;
  if (status !== 'all') filtered = filtered.filter((r) => (r.status ?? 'active') === status);
  if (params?.search) {
    const needle = params.search.toLowerCase();
    filtered = filtered.filter((r) => String(r[nameField]).toLowerCase().includes(needle));
  }
  if (params?.ownerId) filtered = filtered.filter((r) => r.ownerId === params.ownerId);
  if (params?.propertyId) filtered = filtered.filter((r) => r.propertyId === params.propertyId);
  if (params?.category) filtered = filtered.filter((r) => r.category === params.category);

  const total = filtered.length;
  const start = (page - 1) * limit;
  return {
    data: filtered.slice(start, start + limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function notFound(entity: string): Promise<never> {
  const body: ApiError = { code: 'NOT_FOUND', message: `${entity} não encontrado` };
  return Promise.reject(new ApiClientError(404, body));
}

function readOnly(): Promise<never> {
  const body: ApiError = { code: 'FORBIDDEN', message: 'Modo demo é somente leitura' };
  return Promise.reject(new ApiClientError(403, body));
}

export const apiDemo = {
  auth: {
    login: (email: string, password: string, _totpCode?: string): Promise<AuthTokens> => {
      if (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
        return delay(DEMO_TOKENS);
      }
      return Promise.reject(
        new ApiClientError(401, { code: 'UNAUTHORIZED', message: 'E-mail ou senha inválidos' }),
      );
    },
  },
  owners: {
    list: (params?: ListFilters): Promise<Paginated<Owner>> => delay(paginate(DEMO_OWNERS, 'fullName', params)),
    get: (id: string): Promise<Owner> => {
      const owner = DEMO_OWNERS.find((o) => o.id === id);
      return owner ? delay(owner) : notFound('Proprietário');
    },
    create: (_data: CreateOwnerDto): Promise<Owner> => readOnly(),
    update: (_id: string, _data: UpdateOwnerDto): Promise<Owner> => readOnly(),
    remove: (_id: string): Promise<void> => readOnly(),
  },
  properties: {
    // Property (shared-types) não carrega ownerId -- o vínculo é N:N via
    // CreatePropertyDto.ownerIds na criação, não fica exposto na leitura.
    // O filtro `ownerId` do backend real, então, não tem equivalente aqui.
    list: (params?: ListFilters): Promise<Paginated<Property>> =>
      delay(paginate(DEMO_PROPERTIES, 'name', params)),
    get: (id: string): Promise<Property> => {
      const property = DEMO_PROPERTIES.find((p) => p.id === id);
      return property ? delay(property) : notFound('Propriedade');
    },
    create: (_data: CreatePropertyDto): Promise<Property> => readOnly(),
    update: (_id: string, _data: UpdatePropertyDto): Promise<Property> => readOnly(),
    remove: (_id: string): Promise<void> => readOnly(),
  },
  animals: {
    list: (params?: ListFilters): Promise<Paginated<Animal>> => delay(paginate(DEMO_ANIMALS, 'name', params)),
    get: (id: string): Promise<Animal> => {
      const animal = DEMO_ANIMALS.find((a) => a.id === id);
      return animal ? delay(animal) : notFound('Animal');
    },
    create: (_data: CreateAnimalDto): Promise<Animal> => readOnly(),
    update: (_id: string, _data: Omit<UpdateAnimalDto, 'propertyId'>): Promise<Animal> => readOnly(),
    remove: (_id: string): Promise<void> => readOnly(),
    transfer: (_id: string, _toPropertyId: string, _notes?: string): Promise<Animal> => readOnly(),
  },
  products: {
    list: (params?: ListFilters): Promise<Paginated<Product>> =>
      delay(paginate(DEMO_PRODUCTS, 'name', { ...params, status: 'all' })),
    get: (id: string): Promise<Product> => {
      const product = DEMO_PRODUCTS.find((p) => p.id === id);
      return product ? delay(product) : notFound('Produto');
    },
    create: (_data: CreateProductDto): Promise<Product> => readOnly(),
    update: (_id: string, _data: UpdateProductDto): Promise<Product> => readOnly(),
    remove: (_id: string): Promise<void> => readOnly(),
    listMovements: (id: string): Promise<{ data: StockMovement[]; total: number }> => {
      const data = DEMO_MOVEMENTS.filter((m) => m.productId === id);
      return delay({ data, total: data.length });
    },
    recordMovement: (_id: string, _data: CreateMovementDto): Promise<StockMovement> => readOnly(),
  },
  tenants: {
    getMe: (): Promise<TenantProfile> =>
      delay({
        tenantId: '00000000-0000-0000-0000-000000000010',
        tenantName: 'Quíron Equine (Demo)',
        plan: 'plus',
        status: 'active',
        veterinarian: {
          id: '00000000-0000-0000-0000-000000000001',
          userId: '00000000-0000-0000-0000-000000000001',
          fullName: 'Usuário Demo',
          crmv: '00000',
          crmvState: 'GO',
          cpfCnpj: '000.000.000-00',
          phone: '(64) 00000-0000',
          email: 'demo@quironequine.com.br',
          logoUrl: null,
        },
      }),
    updateMe: (_data: UpdateVeterinarianDto): Promise<TenantProfile> => readOnly(),
  },
  uploads: {
    upload: (_file: File): Promise<{ url: string }> => readOnly(),
  },
};
