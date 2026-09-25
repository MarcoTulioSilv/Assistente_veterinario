/**
 * Quíron Equine — Tipos compartilhados entre microsserviços e PWA
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
// `quantityInStock` de propósito fora daqui: mudar o estoque só via
// StockMovement (RF-EST-007) — permitir no PATCH direto do produto
// contornaria o ledger, mesmo problema que RN-010 evita pra animais.
export type UpdateProductDto = Partial<Omit<CreateProductDto, 'quantityInStock'>>;

export type MovementType = 'in' | 'out';
export type MovementReason = 'purchase' | 'appointment' | 'exam' | 'vaccination' | 'manual' | 'expired';

export interface StockMovement {
  id: UUID;
  productId: UUID;
  type: MovementType;
  quantity: number;
  reason: MovementReason;
  referenceId: UUID | null;
  referenceType: string | null;
  notes: string | null;
  createdBy: UUID | null;
  createdAt: ISODateString;
}

/** RF-EST-007: lançamento manual — 'appointment'/'exam'/'vaccination'/'expired' só via broker/AlertService. */
export interface CreateMovementDto {
  type: MovementType;
  quantity: number;
  reason: Extract<MovementReason, 'purchase' | 'manual'>;
  notes?: string;
}

// ═══ MS3 — Clinical ═══════════════════════════════════════════════
/** RF-ATD-002 */
export type AppointmentType = 'clinico_geral' | 'reproducao' | 'odontologico' | 'locomotor' | 'cirurgia';

/**
 * `draft` → em preenchimento, orçamento ainda mutável.
 * `finished` → RF-ATD-008: orçamento congelado, pendência financeira criada,
 * baixa de estoque publicada no broker (RN-003). Transição irreversível.
 */
export type AppointmentStatus = 'draft' | 'finished' | 'cancelled';

/** RF-ATD-005 */
export type AdministrationRoute =
  | 'oral'
  | 'intravenosa'
  | 'intramuscular'
  | 'subcutanea'
  | 'topica'
  | 'intrauterina'
  | 'outra';

/** RF-ATD-006: item de estoque (gera baixa) ou procedimento (só cobra). */
export type AppointmentItemKind = 'product' | 'procedure';

export interface AppointmentItem {
  id: UUID;
  kind: AppointmentItemKind;
  /** Só em `kind: 'product'` — referência ao MS2, sem FK (database-per-service). */
  productId: UUID | null;
  /** Nome congelado no atendimento: o produto pode ser renomeado ou removido depois. */
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  totalCents: Cents;
}

/** RF-ATD-005: prescrição / protocolo de tratamento. */
export interface Prescription {
  id: UUID;
  /** A "flag origem" do RF-ATD-005: do estoque (MS2) quando preenchido, receita externa quando null. */
  productId: UUID | null;
  medicationName: string;
  dose: string;
  route: AdministrationRoute;
  /** Texto livre — "a cada 12h por 5 dias". */
  schedule: string;
  applicationSite: string | null;
  notes: string | null;
}

/**
 * RF-ATD-001: ficha clínica. Os campos narrativos nomeados no requisito são
 * colunas; `generalExam` e `specialExams` são JSONB porque a forma muda por
 * tipo de atendimento (os exames especiais de reprodução não são os mesmos de
 * locomotor) — ADR-001 §4 já previa JSONB pra ficha clínica.
 */
export interface MedicalRecord {
  id: UUID;
  appointmentId: UUID;
  anamnesis: string | null;
  generalExam: Record<string, unknown> | null;
  specialExams: Record<string, unknown> | null;
  diagnosis: string | null;
  treatment: string | null;
  prognosis: string | null;
  referral: string | null;
}

export interface Appointment {
  id: UUID;
  /** Referências ao MS1 — sem FK, sem join (ADR-001 §5.1). */
  ownerId: UUID;
  propertyId: UUID;
  animalId: UUID;
  veterinarianId: UUID;
  type: AppointmentType;
  status: AppointmentStatus;
  /** RF-ATD-004: animal temporariamente fora da propriedade de registro. */
  animalLocation: string | null;
  performedAt: ISODateString;
  // RF-ATD-006 — orçamento. A taxa de km fica gravada aqui (e não lida de uma
  // config global na exibição) pra que o orçamento antigo não mude quando ela mudar.
  laborCents: Cents;
  displacementKm: number;
  displacementRateCents: Cents;
  totalCents: Cents;
  // Situação de pagamento NÃO vive aqui: o ADR-001 §5.3 dá o RN-002 ao
  // Reporting, que cria a pendência a partir de `appointment.done`. Ver
  // `FinancialRecord` / `IFinancialService` na seção MS6.
  finishedAt: ISODateString | null;
  createdAt: ISODateString;
  items: AppointmentItem[];
  prescriptions: Prescription[];
  medicalRecord: MedicalRecord | null;
}

export interface CreateAppointmentItemDto {
  kind: AppointmentItemKind;
  productId?: UUID;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
}

export type CreatePrescriptionDto = Omit<Prescription, 'id' | 'applicationSite' | 'notes'> & {
  applicationSite?: string;
  notes?: string;
};

export type CreateMedicalRecordDto = Partial<Omit<MedicalRecord, 'id' | 'appointmentId'>>;

export interface CreateAppointmentDto {
  ownerId: UUID;
  propertyId: UUID;
  animalId: UUID;
  veterinarianId: UUID;
  type: AppointmentType;
  animalLocation?: string;
  performedAt: ISODateString;
  laborCents?: Cents;
  displacementKm?: number;
  displacementRateCents?: Cents;
  items?: CreateAppointmentItemDto[];
  prescriptions?: CreatePrescriptionDto[];
  medicalRecord?: CreateMedicalRecordDto;
}

export type UpdateAppointmentDto = Partial<Omit<CreateAppointmentDto, 'animalId' | 'ownerId'>>;

export interface IAppointmentService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<Appointment>>;
  findById(ctx: RequestContext, id: UUID): Promise<Appointment | null>;
  /** RF-ATD-011: histórico completo por animal, acessível pela tela do animal. */
  listByAnimal(ctx: RequestContext, animalId: UUID, params: PaginationParams): Promise<Paginated<Appointment>>;
  create(ctx: RequestContext, data: CreateAppointmentDto): Promise<Appointment>;
  /** Só enquanto `status: 'draft'` — depois de finalizado o orçamento está congelado. */
  update(ctx: RequestContext, id: UUID, data: UpdateAppointmentDto): Promise<Appointment>;
  /**
   * RF-ATD-008 + RN-003: congela o orçamento e publica `appointment.done`.
   * O evento tem dois destinos (ADR-001 §5.3): o MS2 baixa o estoque e o MS6
   * abre a pendência financeira. O MS3 não registra pagamento — ver
   * `IFinancialService.registerPayment()`.
   */
  finish(ctx: RequestContext, id: UUID): Promise<Appointment>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
}

// ═══ MS6 — Reporting (fatia financeira, antecipada para o M2) ═════
//
// ATENÇÃO, João: esta seção chegou antes da hora de propósito.
//
// O MS6 inteiro (fluxo de caixa, dashboard, gráficos, configurações) é M3,
// Dez/2026 — isso não mudou. Só a **pendência financeira** foi antecipada
// para o M2, e o motivo é evitar retrabalho seu:
//
// O ADR-001 §5.3 atribui o RN-002 ("cria registro financeiro pendente") ao
// Reporting, não ao Clinical. A primeira versão do schema do MS3 tinha
// `payment_status`/`paid_at` no atendimento e um `registerPayment()` na
// `IAppointmentService` — divergia do ADR. Se isso tivesse ficado de pé até
// Dez/2026, a tela de atendimento teria sido construída contra um contrato
// que mudaria de serviço depois: trocaria endpoint, trocaria o shape da
// resposta, e os dados de pagamento precisariam de migração entre bancos.
//
// Antecipando a fatia, o contrato nasce no lugar certo e a tela é escrita
// uma vez só. Prático: o pagamento não sai da `IAppointmentService`, sai
// daqui; a situação de pagamento de um atendimento é lida do MS6, não do
// MS3 (o BFF compõe, se a tela precisar dos dois juntos).

/** RN-002 / RF-CAD-015: só sai de `pending` com pagamento registrado pelo usuário. */
export type PaymentStatus = 'pending' | 'received';

/** RN-002 cobre os três: atendimento, exame e vacinação. */
export type FinancialSourceType = 'appointment' | 'exam' | 'vaccination';

/**
 * RF-ATD-008 (pendência na aba do proprietário) + RF-REL-004 (todo item
 * registrado vai para o relatório financeiro). Criado a partir de evento do
 * broker, nunca por digitação direta.
 */
export interface FinancialRecord {
  id: UUID;
  /** Dono da pendência — a "aba do proprietário" do RF-ATD-008. */
  ownerId: UUID;
  sourceType: FinancialSourceType;
  /** Id do atendimento/exame/vacinação no MS3 — sem FK (database-per-service). */
  sourceId: UUID;
  amountCents: Cents;
  status: PaymentStatus;
  /** Quando o serviço foi prestado (não quando a pendência foi criada). */
  occurredAt: ISODateString;
  paidAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface CreateFinancialRecordDto {
  ownerId: UUID;
  sourceType: FinancialSourceType;
  sourceId: UUID;
  amountCents: Cents;
  occurredAt: ISODateString;
}

export interface IFinancialService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<FinancialRecord>>;
  /** RF-ATD-008: pendências de um proprietário. */
  listByOwner(ctx: RequestContext, ownerId: UUID, params: PaginationParams): Promise<Paginated<FinancialRecord>>;
  findBySource(ctx: RequestContext, sourceType: FinancialSourceType, sourceId: UUID): Promise<FinancialRecord | null>;
  /**
   * RN-002: única transição para `received`. Publica `payment.registered`
   * (ADR-001 §5.3 — o MS5 notifica o proprietário).
   */
  registerPayment(ctx: RequestContext, id: UUID): Promise<FinancialRecord>;
  /**
   * Disparado por evento do broker, idempotente — mesmo contrato do
   * `IStockService.deduct()`: redelivery não pode duplicar pendência
   * (ADR-001 §5.4).
   */
  recordPending(ctx: RequestContext, data: CreateFinancialRecordDto, idempotencyKey: UUID): Promise<void>;
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

/**
 * Quem consome cada evento — espelha a tabela do ADR-001 §5.3, que é a
 * fonte da verdade. Existe porque o broker (Redis/BullMQ, ADR-002) não
 * tem fan-out nativo: dois workers na MESMA fila competem por round-robin
 * em vez de receberem cópias. Então o publisher entrega uma cópia por
 * assinante, numa fila por serviço — e é esta tabela que diz quais.
 *
 * O nome é o slug do serviço (o `ms-` de `apps/ms-<slug>`), não o nome da
 * fila: `domainEventsQueueName()` monta a fila a partir dele.
 *
 * Serviço que ainda não existe continua listado de propósito: o evento
 * fica acumulado na fila dele até o serviço subir, em vez de se perder.
 */
export const EVENT_SUBSCRIBERS: Record<EventName, readonly string[]> = {
  // RN-003 (baixa de estoque) + RN-002 (pendência financeira) — dois
  // consumidores para o MESMO evento; é o caso que a fila única quebrava.
  [EVENTS.APPOINTMENT_DONE]: ['inventory', 'reporting'],
  [EVENTS.ALERT_TRIGGERED]: ['notification'],
  [EVENTS.PAYMENT_REGISTERED]: ['notification'],
  [EVENTS.SCHEDULE_REMINDER_DUE]: ['notification'],
  [EVENTS.GEOFENCE_TRIGGERED]: ['notification'],
  // Não consta da tabela do ADR-001 §5.3 e não tem consumidor definido —
  // ver ADR-002 §"Pontas soltas". Publicar hoje seria jogar fora.
  [EVENTS.STOCK_DEDUCTED]: [],
};

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

/** RN-002 — publicado pelo ms-reporting ao registrar pagamento, notifica o proprietário (ADR-001 §5.3). */
export interface PaymentRegisteredPayload {
  financialRecordId: UUID;
  ownerId: UUID;
  sourceType: FinancialSourceType;
  sourceId: UUID;
  amountCents: Cents;
  paidAt: ISODateString;
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
