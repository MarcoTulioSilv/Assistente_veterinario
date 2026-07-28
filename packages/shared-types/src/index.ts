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
}

export interface IAnimalService {
  list(ctx: RequestContext, params: PaginationParams & { propertyId?: UUID }): Promise<Paginated<Animal>>;
  findById(ctx: RequestContext, id: UUID): Promise<Animal | null>;
  create(ctx: RequestContext, data: CreateAnimalDto): Promise<Animal>;
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
  propertyIds?: UUID[];
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
  propertyId?: UUID;
  ownerId?: UUID;
}

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
  costPriceCents: Cents;
  markupPercent: number;
  salePriceCents: Cents;
  expiryDate: ISODateString | null;
  minStockQty: number;
  category: ProductCategory;
  isNearExpiry: boolean;
  isLowStock: boolean;
}

export interface IStockService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<Product>>;
  create(ctx: RequestContext, data: CreateProductDto): Promise<Product>;
  /** RN-003: baixa idempotente disparada por evento do broker */
  deduct(ctx: RequestContext, productId: UUID, qty: number, idempotencyKey: UUID): Promise<void>;
}

export interface CreateProductDto {
  name: string;
  manufacturer?: string;
  batch?: string;
  unit: ProductUnit;
  quantityInStock?: number;
  costPriceCents: Cents;
  markupPercent?: number;
  expiryDate?: ISODateString;
  minStockQty?: number;
  category: ProductCategory;
}

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
