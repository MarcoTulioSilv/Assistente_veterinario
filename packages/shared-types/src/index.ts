/**
 * VetEquine — Tipos compartilhados entre microsserviços e PWA
 *
 * IMPORTANTE (Plano de Trabalho §5.1):
 * Dev 1 publica as INTERFACES aqui ANTES de implementar os Services.
 * Dev 2 usa essas interfaces para criar MockServices e trabalhar em paralelo.
 */

// ═══ Primitivos ═══════════════════════════════════════════════════
export type UUID = string;
export type ISODateString = string;

/** Valores monetários SEMPRE em centavos (INTEGER) — ADR-001 §5.6 */
export type Cents = number;

// ═══ Contexto de request ══════════════════════════════════════════
export interface RequestContext {
  tenantId: UUID;
  userId: UUID;
  role: UserRole;
  plan: TenantPlan;
  traceId: string;
}

export type UserRole = 'admin' | 'assistant';
export type TenantPlan = 'basic' | 'plus';
export type TenantStatus = 'active' | 'suspended' | 'cancelled';
export type RecordStatus = 'pending' | 'active';

// ═══ Paginação ════════════════════════════════════════════════════
export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

// ═══ Erros padronizados ═══════════════════════════════════════════
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PLAN_LIMIT_REACHED'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ErrorCode;
  message: string;
  traceId?: string;
  errors?: Array<{ field: string; message: string }>;
}

// ═══ MS1 — Identity & Registry ════════════════════════════════════
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserSummary;
}

export interface UserSummary {
  id: UUID;
  email: string;
  fullName: string;
  role: UserRole;
  plan: TenantPlan;
  tenantId: UUID;
}

export interface TenantProfile {
  tenantId: UUID;
  tenantName: string;
  plan: TenantPlan;
  status: TenantStatus;
  veterinarian: {
    id: UUID;
    userId: UUID;
    fullName: string;
    crmv: string;
    crmvState: string;
    cpfCnpj: string;
    phone: string;
    email: string;
    logoUrl: string | null;
  };
}

export interface Owner {
  id: UUID;
  fullName: string;
  cpf: string | null;
  email: string | null;
  phone: string;
  phone2: string | null;
  address: string | null;
  city: string;
  state: string;
  status: RecordStatus;
  notifyBlocked: boolean;
  createdAt: ISODateString;
}

export interface Property {
  id: UUID;
  name: string;
  address: string | null;
  city: string;
  state: string;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  status: RecordStatus;
  createdAt: ISODateString;
}

export interface Animal {
  id: UUID;
  name: string;
  species: string;
  sex: 'male' | 'female' | null;
  breed: string | null;
  coat: string | null;
  birthDate: ISODateString | null;
  castrated: boolean;
  photoUrl: string | null;
  sketchUrl: string | null;
  status: RecordStatus;
  propertyId: UUID | null;
  ownerId: UUID | null;
  createdAt: ISODateString;
}

// ─── Interfaces de Service (contrato Dev1 → Dev2) ─────────────────
export interface IAuthService {
  login(email: string, password: string, totpCode?: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(userId: UUID): Promise<void>;
}

/**
 * RF-CAD-030 (ERS) / UC-CAD-04 — "Gerenciar Dados do Veterinário".
 * Neste domínio o tenant É o veterinário assinante; register() cria
 * Tenant+User(admin)+Veterinarian juntos. logoUrl aceita só uma URL já
 * hospedada — não há upload de arquivo (S3/R2) implementado ainda.
 */
export interface ITenantService {
  register(data: RegisterTenantDto): Promise<TenantProfile>;
  getMyProfile(ctx: RequestContext): Promise<TenantProfile>;
  updateVeterinarianProfile(ctx: RequestContext, data: UpdateVeterinarianDto): Promise<TenantProfile>;
}

export interface RegisterTenantDto {
  fullName: string;
  crmv: string;
  crmvState: string;
  cpfCnpj: string;
  phone: string;
  email: string;
  password: string;
  /** URL já hospedada — sem upload real ainda, ver ITenantService. */
  logoUrl?: string;
  /** Nome do tenant/clínica; default = fullName se omitido (RF-CAD-030 não define campo próprio). */
  tenantName?: string;
}
export type UpdateVeterinarianDto = Partial<Pick<RegisterTenantDto, 'fullName' | 'phone' | 'email' | 'logoUrl'>>;

export interface IOwnerService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<Owner>>;
  findById(ctx: RequestContext, id: UUID): Promise<Owner | null>;
  create(ctx: RequestContext, data: CreateOwnerDto): Promise<Owner>;
  update(ctx: RequestContext, id: UUID, data: UpdateOwnerDto): Promise<Owner>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
}

export interface IPropertyService {
  list(ctx: RequestContext, params: PaginationParams & { ownerId?: UUID }): Promise<Paginated<Property>>;
  findById(ctx: RequestContext, id: UUID): Promise<Property | null>;
  create(ctx: RequestContext, data: CreatePropertyDto): Promise<Property>;
  update(ctx: RequestContext, id: UUID, data: UpdatePropertyDto): Promise<Property>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
}

export interface IAnimalService {
  list(ctx: RequestContext, params: PaginationParams & { propertyId?: UUID }): Promise<Paginated<Animal>>;
  findById(ctx: RequestContext, id: UUID): Promise<Animal | null>;
  create(ctx: RequestContext, data: CreateAnimalDto): Promise<Animal>;
  update(ctx: RequestContext, id: UUID, data: UpdateAnimalDto): Promise<Animal>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
  /** RN-010: preserva histórico integralmente */
  transfer(ctx: RequestContext, id: UUID, toPropertyId: UUID, notes?: string): Promise<Animal>;
}

// ─── DTOs ─────────────────────────────────────────────────────────
export interface CreateOwnerDto {
  fullName: string;
  cpf?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
}
export type UpdateOwnerDto = Partial<CreateOwnerDto>;

export interface CreatePropertyDto {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  ownerIds?: UUID[];
}
export type UpdatePropertyDto = Partial<CreatePropertyDto>;

export interface CreateAnimalDto {
  name: string;
  species?: string;
  sex?: 'male' | 'female';
  breed?: string;
  coat?: string;
  birthDate?: ISODateString;
  castrated?: boolean;
  /** URL já hospedada — sem upload real ainda (mesmo padrão de Veterinarian.logoUrl). */
  photoUrl?: string;
  /** RF-CAD-023 — resenha/desenho, opcional, só pra equinos. Mesma ressalva de upload. */
  sketchUrl?: string;
  propertyId?: UUID;
  ownerId?: UUID;
}
export type UpdateAnimalDto = Partial<CreateAnimalDto>;

// ═══ MS2 — Inventory ══════════════════════════════════════════════
export type ProductUnit =
  | 'ampola' | 'bolsa' | 'caixa' | 'frasco' | 'galao'
  | 'grama' | 'kg' | 'litros' | 'ml' | 'pacote' | 'peca' | 'unidade';

export type ProductCategory = 'medication' | 'vaccine' | 'supply';

export interface Product {
  id: UUID;
  name: string;
  manufacturer: string | null;
  batch: string | null;
  unit: ProductUnit;
  quantityInStock: number;
  dosesPerUnit: number | null;
  costPriceCents: Cents;
  markupPercent: number;
  salePriceCents: Cents;
  expiryDate: ISODateString | null;
  alertDaysBefore: number | null;
  minStockQty: number;
  category: ProductCategory;
  isNearExpiry: boolean;
  isLowStock: boolean;
}

export interface IStockService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<Product>>;
  findById(ctx: RequestContext, id: UUID): Promise<Product | null>;
  create(ctx: RequestContext, data: CreateProductDto): Promise<Product>;
  update(ctx: RequestContext, id: UUID, data: UpdateProductDto): Promise<Product>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
  /**
   * RN-003: baixa idempotente disparada por evento do broker.
   * `reference` liga o StockMovement resultante de volta à origem (ex.:
   * o atendimento que consumiu o produto) — opcional/compatível com
   * quem já chama sem ele.
   */
  deduct(
    ctx: RequestContext,
    productId: UUID,
    qty: number,
    idempotencyKey: UUID,
    reference?: { referenceId: UUID; referenceType: string },
  ): Promise<void>;
}

export interface CreateProductDto {
  name: string;
  manufacturer?: string;
  batch?: string;
  unit: ProductUnit;
  quantityInStock?: number;
  dosesPerUnit?: number;
  costPriceCents: Cents;
  markupPercent?: number;
  expiryDate?: ISODateString;
  alertDaysBefore?: number;
  minStockQty?: number;
  category: ProductCategory;
}
export type UpdateProductDto = Partial<CreateProductDto>;

// ═══ Eventos do Message Broker (ADR-001 §5.3) ═════════════════════
export const EVENTS = {
  APPOINTMENT_DONE: 'appointment.done',
  STOCK_DEDUCTED: 'stock.deducted',
  ALERT_TRIGGERED: 'alert.triggered',
  PAYMENT_REGISTERED: 'payment.registered',
  SCHEDULE_REMINDER_DUE: 'schedule.reminder_due',
  GEOFENCE_TRIGGERED: 'geofence.triggered',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface DomainEvent<T = unknown> {
  name: EventName;
  tenantId: UUID;
  traceId: string;
  idempotencyKey: UUID;
  occurredAt: ISODateString;
  payload: T;
}

export interface AppointmentDonePayload {
  appointmentId: UUID;
  ownerId: UUID;
  totalCostCents: Cents;
  consumedItems: Array<{ productId: UUID; quantity: number }>;
}

/** RF-EST-004/005 — detectado pelo ms-inventory, entregue por um futuro ms-notification */
export interface AlertTriggeredPayload {
  productId: UUID;
  alertType: 'expiry' | 'low_stock';
  productName: string;
  expiryDate?: ISODateString;
  quantityInStock?: number;
}

// ═══ Upload de arquivos ═══════════════════════════════════════════
/**
 * Fonte única dos tipos de imagem aceitos por upload — a extensão de cada
 * um é o dado que faltava pra derivar tudo o resto (o conjunto de mime
 * types permitidos é Object.keys() disto). Usado por três lugares que
 * antes tinham cópias divergentes: upload.controller.ts (validação
 * server-side), local-storage-adapter.ts (nome do arquivo salvo) e
 * ImageUploadField.tsx (pre-check no client, puramente cosmético — quem
 * decide de verdade é sempre o server, ver image-sniff.ts).
 */
export const UPLOAD_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const UPLOAD_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
