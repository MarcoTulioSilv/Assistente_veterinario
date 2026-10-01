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
   * `reference` liga o StockMovement resultante de volta à origem (o
   * atendimento ou exame que consumiu o produto) e também define o MOTIVO
   * do movimento — consumo de exame sai como `exam`, não como `appointment`.
   * Sem `reference`, o motivo é `appointment` (compatível com quem já chama).
   */
  deduct(
    ctx: RequestContext,
    productId: UUID,
    qty: number,
    idempotencyKey: UUID,
    reference?: { referenceId: UUID; referenceType: StockConsumptionSource },
  ): Promise<void>;
}

/**
 * De onde vem um consumo de estoque (RN-003). Cada valor também é um
 * `MovementReason` — é o motivo registrado na movimentação.
 */
export type StockConsumptionSource = 'appointment' | 'exam' | 'vaccination';

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
  /**
   * Soft delete (LGPD). Atendimento em rascunho só some — nunca gerou
   * cobrança. Atendimento FINALIZADO também pode ser excluído, mas publica
   * `appointment.deleted` e o MS6 cancela a pendência financeira dele.
   *
   * ATENÇÃO, João — a tela precisa de um pop-up BLOQUEANTE antes de excluir
   * atendimento com `status: 'finished'` (decisão do Marco). O aviso deve
   * dizer que:
   *  - a pendência financeira do proprietário será cancelada;
   *  - se o atendimento já foi PAGO, o registro de pagamento é mantido (não
   *    se apaga dinheiro recebido) — dá pra saber pelo
   *    `IFinancialService.findBySource('appointment', id)`;
   *  - o estoque consumido NÃO volta: o produto foi de fato usado no animal.
   * Rascunho não precisa do aviso.
   */
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
}

// ─── MS3 — Exames (RF-EXM-001 a 006, Sprint 6) ────────────────────
//
// Decisões do Marco e dos stakeholders (01/10/2026), que definem o modelo:
//  - status e laudo são do PEDIDO inteiro, não de cada animal;
//  - no máximo uma pendência financeira por pedido (RN-002);
//  - o prazo do tipo gera a DATA PREVISTA do resultado; o status só avança
//    por ação real (coleta, envio ao laboratório, laudo anexado);
//  - o catálogo de tipos é de cada clínica e começa VAZIO — nada é imposto.
//    EXAM_TYPE_SUGGESTIONS só ajuda a preencher;
//  - a COLETA é opcional: outra pessoa pode colher a amostra;
//  - a COBRANÇA é opcional: o cliente pode pagar o laboratório direto.
//
// Como a cobrança depende de quem coletou, ela só fecha na primeira saída de
// `requested` — registrando a coleta, ou pulando direto pra análise/resultado:
//  - vet cobra o exame: procedimento × animais + (se coletou: mão de obra + km);
//    insumos não entram (RF-EXM-006: "sem custo, apenas controle");
//  - cliente paga o laboratório direto: se o vet coletou, mão de obra + km +
//    insumos; se não coletou, nada. Esta é uma exceção ao RF-EXM-006 — sem o
//    procedimento na conta, os insumos deixam de estar embutidos nele.

/** RF-EXM-002: tipo de um campo do protocolo de exame. */
export type ExamProtocolFieldType = 'text' | 'number' | 'date' | 'select';

/**
 * RF-EXM-002: um campo específico do protocolo. O PWA monta o formulário a
 * partir desta lista, e o MS3 valida os valores do pedido contra ela.
 */
export interface ExamProtocolField {
  /** Chave no `protocolData` do pedido — letras, números e `_`. */
  key: string;
  label: string;
  type: ExamProtocolFieldType;
  /** Cobrado só ao confirmar a coleta; o rascunho pode ficar incompleto. */
  required: boolean;
  /** Obrigatório (e só aceito) em `select`. */
  options?: string[];
}

/** Catálogo da clínica (RF-EXM-002/004/006). */
export interface ExamType {
  id: UUID;
  name: string;
  /** Preço do procedimento POR ANIMAL — sugerido no pedido, editável lá. */
  defaultPriceCents: Cents;
  /** O "tempo previamente cadastrado" do RF-EXM-004. Nulo = sem data prevista nem lembrete. */
  expectedTurnaroundDays: number | null;
  protocolFields: ExamProtocolField[];
  createdAt: ISODateString;
}

export interface CreateExamTypeDto {
  name: string;
  defaultPriceCents?: Cents;
  expectedTurnaroundDays?: number | null;
  protocolFields?: ExamProtocolField[];
}

export type UpdateExamTypeDto = Partial<CreateExamTypeDto>;

export interface IExamTypeService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<ExamType>>;
  findById(ctx: RequestContext, id: UUID): Promise<ExamType | null>;
  create(ctx: RequestContext, data: CreateExamTypeDto): Promise<ExamType>;
  /** Não altera pedidos já criados: cada pedido guarda a própria cópia dos campos. */
  update(ctx: RequestContext, id: UUID, data: UpdateExamTypeDto): Promise<ExamType>;
  softDelete(ctx: RequestContext, id: UUID): Promise<void>;
}

export interface ExamTypeSuggestion {
  name: string;
  protocolFields: ExamProtocolField[];
}

/** Campos genéricos de qualquer requisição de exame de laboratório. */
const EXAM_REQUEST_GENERIC_FIELDS: ExamProtocolField[] = [
  {
    key: 'finalidade',
    label: 'Finalidade',
    type: 'select',
    required: false,
    options: ['Trânsito (GTA)', 'Evento ou competição', 'Compra e venda', 'Rotina', 'Outra'],
  },
  { key: 'laboratorio', label: 'Laboratório', type: 'text', required: false },
  { key: 'numero_requisicao', label: 'Nº da requisição', type: 'text', required: false },
];

/**
 * Sugestões pra ajudar o veterinário a montar o catálogo — NÃO entram no
 * catálogo sozinhas: uma clínica pode prestar um serviço só (decisão do
 * Marco). O PWA oferece a lista; escolhida uma, vira um `CreateExamTypeDto`
 * já preenchido, que o vet ajusta. Sem preço nem prazo de propósito: são da
 * clínica e do laboratório dela. Ampliar a lista com os stakeholders.
 */
export const EXAM_TYPE_SUGGESTIONS: readonly ExamTypeSuggestion[] = [
  { name: 'Mormo', protocolFields: EXAM_REQUEST_GENERIC_FIELDS },
  { name: 'AIE (Anemia Infecciosa Equina)', protocolFields: EXAM_REQUEST_GENERIC_FIELDS },
];

/**
 * RF-EXM-004, com a coleta opcional: `draft → requested → [collected] →
 * in_analysis → result_available`. `collected` só existe se o veterinário
 * colheu; de `requested` dá pra ir direto pra análise ou resultado. Só avança
 * por ação real: nunca afirma um resultado que não existe.
 */
export type ExamStatus = 'draft' | 'requested' | 'collected' | 'in_analysis' | 'result_available';

/**
 * RF-EXM-006: insumo usado na coleta — sempre dá baixa no estoque. Só é
 * COBRADO quando o cliente paga o laboratório direto (ver cabeçalho da seção).
 */
export interface ExamRequestItem {
  id: UUID;
  productId: UUID;
  /** Nome e preço congelados no pedido, como nos itens do atendimento. */
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  totalCents: Cents;
}

/** RF-EXM-001: o pedido de exame. */
export interface ExamRequest {
  id: UUID;
  /** Referências ao MS1 — sem FK (ADR-001 §5.1). */
  ownerId: UUID;
  propertyId: UUID;
  veterinarianId: UUID;
  examTypeId: UUID;
  /** Cópia do tipo no momento do pedido: o vet pode editar o tipo depois. */
  examTypeName: string;
  protocolFields: ExamProtocolField[];
  protocolData: Record<string, unknown>;
  /** Coleta — preenchidos só se o veterinário colheu (`registerCollection`). */
  material: string | null;
  collectedAt: ISODateString | null;
  /** RF-EXM-003. O pedido tem animais, OU um lote, OU os dois. */
  animalIds: UUID[];
  lotDescription: string | null;
  lotSize: number | null;
  status: ExamStatus;
  /** Data de coleta + prazo do tipo. Base do lembrete D-1/no dia. */
  expectedResultAt: ISODateString | null;
  /** RF-EXM-005 — o arquivo sobe pelo endpoint de upload; aqui só a URL. */
  resultFileUrl: string | null;
  resultUploadedAt: ISODateString | null;
  /** O cliente paga o laboratório direto — muda o que entra na conta. */
  paidDirectlyByClient: boolean;
  // RF-EXM-006. Mão de obra e km só existem se o veterinário coletou.
  /** Preço do procedimento por animal. */
  unitPriceCents: Cents;
  laborCents: Cents;
  displacementKm: number;
  displacementRateCents: Cents;
  /** Valor cobrado, congelado quando a cobrança fecha. 0 = nada a cobrar. */
  totalCents: Cents;
  /** Quando a cobrança fechou. Nulo = ainda pode mudar (rascunho/solicitado). */
  chargedAt: ISODateString | null;
  createdAt: ISODateString;
  items: ExamRequestItem[];
}

export interface CreateExamRequestItemDto {
  productId: UUID;
  description: string;
  quantity: number;
  /** Preço de venda do produto (MS2) — só pesa se o cliente paga o laboratório direto. */
  unitPriceCents: Cents;
}

export interface CreateExamRequestDto {
  ownerId: UUID;
  propertyId: UUID;
  veterinarianId: UUID;
  examTypeId: UUID;
  protocolData?: Record<string, unknown>;
  animalIds?: UUID[];
  /** `null` tira o lote do pedido (na edição). */
  lotDescription?: string | null;
  lotSize?: number | null;
  /** Se ausente, vem do `defaultPriceCents` do tipo. */
  unitPriceCents?: Cents;
  paidDirectlyByClient?: boolean;
}

/** Permitido até a cobrança fechar (rascunho e solicitado). */
export type UpdateExamRequestDto = Partial<Omit<CreateExamRequestDto, 'ownerId'>>;

/** Coleta feita pelo veterinário (opcional no fluxo). */
export interface RegisterExamCollectionDto {
  material: string;
  collectedAt: ISODateString;
  items?: CreateExamRequestItemDto[];
  laborCents?: Cents;
  displacementKm?: number;
  displacementRateCents?: Cents;
}

export interface IExamService {
  list(ctx: RequestContext, params: PaginationParams): Promise<Paginated<ExamRequest>>;
  findById(ctx: RequestContext, id: UUID): Promise<ExamRequest | null>;
  /** RF-CAD-026: exames na tela do animal. Pedido só por lote não entra. */
  listByAnimal(ctx: RequestContext, animalId: UUID, params: PaginationParams): Promise<Paginated<ExamRequest>>;
  create(ctx: RequestContext, data: CreateExamRequestDto): Promise<ExamRequest>;
  /**
   * Até a cobrança fechar (rascunho e solicitado). Trocar o tipo troca também
   * a cópia dos campos do protocolo. Em `requested`, os obrigatórios do
   * protocolo continuam cobrados.
   */
  update(ctx: RequestContext, id: UUID, data: UpdateExamRequestDto): Promise<ExamRequest>;
  /** `draft → requested`: emite o pedido. Exige animais ou lote e os obrigatórios do protocolo. */
  issue(ctx: RequestContext, id: UUID): Promise<ExamRequest>;
  /**
   * `requested → collected`: o veterinário colheu. Publica `exam.collected`
   * (baixa dos insumos, RN-003) e fecha a cobrança (`exam.charged`, se houver
   * valor). Calcula a data prevista do resultado a partir da coleta.
   */
  registerCollection(ctx: RequestContext, id: UUID, data: RegisterExamCollectionDto): Promise<ExamRequest>;
  /**
   * `requested | collected → in_analysis`: amostra no laboratório. Saindo de
   * `requested` (outra pessoa coletou), é aqui que a cobrança fecha.
   */
  sendToAnalysis(ctx: RequestContext, id: UUID): Promise<ExamRequest>;
  /**
   * RF-EXM-005: anexa o laudo e vai pra `result_available`. Aceita pular
   * etapas (o vet pode não ter marcado o envio) e reanexar (correção). Se
   * ainda estava em `requested`, fecha a cobrança também.
   */
  attachResult(ctx: RequestContext, id: UUID, resultFileUrl: string): Promise<ExamRequest>;
  /**
   * Pedido que ainda não cobrou nada some em silêncio. Pedido com cobrança
   * fechada publica `exam.deleted` e o MS6 cancela a pendência. Estoque não
   * volta.
   *
   * ATENÇÃO, João — mesmo pop-up BLOQUEANTE do atendimento antes de excluir
   * pedido com `chargedAt` preenchido (`IAppointmentService.softDelete`).
   */
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

/**
 * RN-002 / RF-CAD-015: só sai de `pending` para `received` com pagamento
 * registrado pelo usuário. `cancelled` vem da exclusão do atendimento de
 * origem — e só a partir de `pending`: pagamento recebido nunca é cancelado.
 */
export type PaymentStatus = 'pending' | 'received' | 'cancelled';

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
  cancelledAt: ISODateString | null;
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
  /**
   * Disparado por `appointment.deleted`, idempotente. Cancela a pendência da
   * origem se ela estiver `pending`; se já foi `received`, mantém. Funciona
   * em qualquer ordem de chegada: se a exclusão for processada antes da
   * criação da pendência (retry do broker), deixa a origem marcada como
   * cancelada e a pendência já nasce cancelada.
   */
  cancelBySource(ctx: RequestContext, data: CreateFinancialRecordDto, idempotencyKey: UUID): Promise<void>;
}

// ═══ Eventos do Message Broker (ADR-001 §5.3) ═════════════════════
export const EVENTS = {
  APPOINTMENT_DONE: 'appointment.done',
  APPOINTMENT_DELETED: 'appointment.deleted',
  EXAM_COLLECTED: 'exam.collected',
  EXAM_CHARGED: 'exam.charged',
  EXAM_DELETED: 'exam.deleted',
  EXAM_RESULT_DUE: 'exam.result_due',
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
  // Não consta da tabela do §5.3 — nasceu da regra de exclusão de
  // atendimento finalizado (ADR-002, revisão 1.2). Só o reporting assina:
  // o estoque consumido não volta, o produto foi de fato usado no animal.
  [EVENTS.APPOINTMENT_DELETED]: ['reporting'],
  // Exames (ADR-002, revisão 1.3). Diferente do atendimento, baixa e
  // cobrança são eventos SEPARADOS: a coleta é opcional e a cobrança também,
  // então um pedido pode ter uma sem a outra.
  [EVENTS.EXAM_COLLECTED]: ['inventory'],
  [EVENTS.EXAM_CHARGED]: ['reporting'],
  [EVENTS.EXAM_DELETED]: ['reporting'],
  // Lembrete D-1 e no dia pra buscar o resultado. Quem entrega push e
  // notificação é o MS5 (dez/2026); até lá o evento espera na fila dele.
  [EVENTS.EXAM_RESULT_DUE]: ['notification'],
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
  /**
   * Quando o atendimento foi REALIZADO — é a data da pendência financeira
   * (o relatório agrupa por ela). Não confundir com o `occurredAt` do
   * envelope, que é quando ele foi finalizado no sistema: um atendimento
   * feito dia 30 e fechado dia 2 cairia no mês errado.
   */
  performedAt: ISODateString;
}

/**
 * Exclusão de atendimento FINALIZADO (rascunho não publica nada — nunca
 * gerou cobrança). Carrega o mesmo que a pendência precisaria, pra que o MS6
 * consiga registrar a origem como cancelada mesmo que a exclusão chegue antes
 * do `appointment.done` (reprocessamento do broker fora de ordem).
 */
export interface AppointmentDeletedPayload {
  appointmentId: UUID;
  ownerId: UUID;
  totalCostCents: Cents;
  /** Quando o atendimento foi realizado — a data da pendência, não da exclusão. */
  performedAt: ISODateString;
}

/** O veterinário colheu e usou insumos: baixa no MS2 (RN-003). Coleta sem insumo não publica. */
export interface ExamCollectedPayload {
  examRequestId: UUID;
  consumedItems: Array<{ productId: UUID; quantity: number }>;
}

/** Cobrança do pedido fechada com valor > 0: o MS6 abre a pendência (RN-002). */
export interface ExamChargedPayload {
  examRequestId: UUID;
  ownerId: UUID;
  totalCostCents: Cents;
  /** Data da coleta, ou do envio ao laboratório se outra pessoa coletou — a data da pendência. */
  performedAt: ISODateString;
}

/** Pedido com cobrança fechada foi excluído: o MS6 cancela a pendência. */
export interface ExamDeletedPayload {
  examRequestId: UUID;
  ownerId: UUID;
  totalCostCents: Cents;
  performedAt: ISODateString;
}

/** Lembrete pra buscar o resultado: um dia antes e no dia da data prevista. */
export interface ExamResultDuePayload {
  examRequestId: UUID;
  ownerId: UUID;
  /** Quem deve ser lembrado. */
  veterinarianId: UUID;
  examTypeName: string;
  expectedResultAt: ISODateString;
  kind: 'day_before' | 'due_today';
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
