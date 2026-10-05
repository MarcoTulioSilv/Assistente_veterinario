import { EVENTS } from '@quironequine/shared-types';
import type {
  IExamService,
  RequestContext,
  UUID,
  Paginated,
  ExamRequest,
  ExamStatus,
  ExamProtocolField,
  ExamCollectedPayload,
  ExamChargedPayload,
  ExamDeletedPayload,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type {
  ExamRepository,
  ExamRequestItemData,
  UpdateExamRequestData,
} from '../repositories/exam.repository';
import type { ExamTypeRepository } from '../repositories/exam-type.repository';
import type {
  CreateExamRequestInput,
  UpdateExamRequestInput,
  ListExamRequestsInput,
  RegisterExamCollectionInput,
  ExamRequestItemInput,
} from '../schemas/exam.schema';
import { calculateTotalCents, calculateItemTotalCents, deriveEventIdempotencyKey } from './billing';
import { validateProtocolData } from './exam-protocol';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rascunho e solicitado: a cobrança ainda não fechou. */
const EDITABLE: ExamStatus[] = ['draft', 'requested'];

interface CollectionCost {
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
  items: Array<{ totalCents: number }>;
}

/** Animais identificados + cabeças do lote — o procedimento é cobrado por animal. */
export function countSubjects(exam: Pick<ExamRequest, 'animalIds' | 'lotSize'>): number {
  return exam.animalIds.length + (exam.lotSize ?? 0);
}

/**
 * RF-EXM-006 com as decisões dos stakeholders (01/10/2026). `collection`
 * nulo = o veterinário não colheu (outra pessoa colheu a amostra).
 *
 *  - vet cobra o exame: procedimento × animais + (se coletou: mão de obra + km).
 *    Insumos não entram — "sem custo, apenas controle", estão embutidos no
 *    procedimento;
 *  - cliente paga o laboratório direto: se coletou, mão de obra + km +
 *    insumos (sem procedimento na conta, os insumos deixam de estar embutidos
 *    nele); se não coletou, nada.
 */
export function calculateExamChargeCents(input: {
  paidDirectlyByClient: boolean;
  unitPriceCents: number;
  subjects: number;
  collection: CollectionCost | null;
}): number {
  const { collection } = input;
  const procedureCents = input.paidDirectlyByClient ? 0 : input.unitPriceCents * input.subjects;
  if (!collection) return procedureCents;

  return (
    procedureCents +
    calculateTotalCents({
      items: input.paidDirectlyByClient ? collection.items : [],
      laborCents: collection.laborCents,
      displacementKm: collection.displacementKm,
      displacementRateCents: collection.displacementRateCents,
    })
  );
}

/** RF-EXM-004: data base + prazo cadastrado no tipo. Sem prazo, sem data prevista. */
export function calculateExpectedResultAt(base: Date, turnaroundDays: number | null): Date | null {
  return turnaroundDays === null ? null : new Date(base.getTime() + turnaroundDays * DAY_MS);
}

/** A data da pendência: a coleta, se o vet colheu; senão, quando a cobrança fechou. */
function chargeDate(exam: ExamRequest): string {
  return exam.collectedAt ?? exam.chargedAt ?? new Date().toISOString();
}

export function buildExamCollectedEvent(
  ctx: RequestContext,
  exam: ExamRequest,
): DomainEvent<ExamCollectedPayload> {
  return {
    name: EVENTS.EXAM_COLLECTED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    // Um pedido só sai de `requested` uma vez — a chave derivada é única.
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.EXAM_COLLECTED, exam.id),
    occurredAt: new Date().toISOString(),
    payload: {
      examRequestId: exam.id,
      consumedItems: exam.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    },
  };
}

export function buildExamChargedEvent(ctx: RequestContext, exam: ExamRequest): DomainEvent<ExamChargedPayload> {
  return {
    name: EVENTS.EXAM_CHARGED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.EXAM_CHARGED, exam.id),
    occurredAt: new Date().toISOString(),
    payload: {
      examRequestId: exam.id,
      ownerId: exam.ownerId,
      totalCostCents: exam.totalCents,
      performedAt: chargeDate(exam),
    },
  };
}

export function buildExamDeletedEvent(ctx: RequestContext, exam: ExamRequest): DomainEvent<ExamDeletedPayload> {
  return {
    name: EVENTS.EXAM_DELETED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: deriveEventIdempotencyKey(EVENTS.EXAM_DELETED, exam.id),
    occurredAt: new Date().toISOString(),
    payload: {
      examRequestId: exam.id,
      ownerId: exam.ownerId,
      totalCostCents: exam.totalCents,
      performedAt: chargeDate(exam),
    },
  };
}

/** Só pedido que de fato gerou pendência (cobrança fechada com valor) precisa avisar o MS6. */
export function generatedPendency(exam: Pick<ExamRequest, 'chargedAt' | 'totalCents'>): boolean {
  return exam.chargedAt !== null && exam.totalCents > 0;
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IExamService publicada em shared-types.
 *
 * Fluxo: `draft → requested → [collected] → in_analysis → result_available`.
 * A cobrança fecha na PRIMEIRA saída de `requested`, porque só aí se sabe se
 * o veterinário coletou — e o que entra na conta depende disso.
 */
export class ExamService implements IExamService {
  constructor(
    private readonly repo: ExamRepository,
    private readonly types: ExamTypeRepository,
  ) {}

  async list(ctx: RequestContext, params: ListExamRequestsInput): Promise<Paginated<ExamRequest>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<ExamRequest | null> {
    return this.repo.findById(ctx, id);
  }

  /** RF-CAD-026 */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListExamRequestsInput,
  ): Promise<Paginated<ExamRequest>> {
    return this.repo.listByAnimal(ctx, animalId, params);
  }

  /** Nasce rascunho: pode estar incompleto, mas não pode carregar campo que o protocolo não tem. */
  async create(ctx: RequestContext, data: CreateExamRequestInput): Promise<ExamRequest> {
    const type = await this.types.findById(ctx, data.examTypeId);
    if (!type) throw AppError.notFound('Tipo de exame não encontrado');

    return this.repo.create(ctx, {
      ownerId: data.ownerId,
      propertyId: data.propertyId,
      veterinarianId: data.veterinarianId,
      examTypeId: type.id,
      examTypeName: type.name,
      protocolFields: type.protocolFields,
      protocolData: validateProtocolData(type.protocolFields, data.protocolData ?? {}, {
        requireMandatory: false,
      }),
      animalIds: dedupe(data.animalIds ?? []),
      lotDescription: data.lotDescription ?? null,
      lotSize: data.lotSize ?? null,
      unitPriceCents: data.unitPriceCents ?? type.defaultPriceCents,
      paidDirectlyByClient: data.paidDirectlyByClient ?? false,
    });
  }

  /**
   * Até a cobrança fechar. Trocar o tipo troca a cópia dos campos — os
   * valores já preenchidos que existem no tipo novo são mantidos, o resto
   * cai — e, se o preço não veio junto, o preço sugerido do tipo novo.
   * Pedido já emitido continua tendo que estar completo.
   */
  async update(ctx: RequestContext, id: UUID, data: UpdateExamRequestInput): Promise<ExamRequest> {
    const existing = await this.requireExam(ctx, id);
    if (!EDITABLE.includes(existing.status)) {
      throw AppError.conflict('Pedido não pode mais ser editado — a cobrança já fechou');
    }

    let protocolFields: ExamProtocolField[] = existing.protocolFields;
    let protocolData: Record<string, unknown> = existing.protocolData;
    const changes: UpdateExamRequestData = {};

    if (data.examTypeId !== undefined && data.examTypeId !== existing.examTypeId) {
      const type = await this.types.findById(ctx, data.examTypeId);
      if (!type) throw AppError.notFound('Tipo de exame não encontrado');
      protocolFields = type.protocolFields;
      const keys = new Set(protocolFields.map((field) => field.key));
      protocolData = Object.fromEntries(Object.entries(protocolData).filter(([key]) => keys.has(key)));
      Object.assign(changes, {
        examTypeId: type.id,
        examTypeName: type.name,
        protocolFields,
        unitPriceCents: data.unitPriceCents ?? type.defaultPriceCents,
      });
    }

    if (data.protocolData !== undefined) protocolData = data.protocolData;
    const issued = existing.status === 'requested';
    changes.protocolData = validateProtocolData(protocolFields, protocolData, { requireMandatory: issued });

    if (data.animalIds !== undefined) changes.animalIds = dedupe(data.animalIds);
    if (data.lotDescription !== undefined) changes.lotDescription = data.lotDescription;
    if (data.lotSize !== undefined) changes.lotSize = data.lotSize;
    if (data.propertyId !== undefined) changes.propertyId = data.propertyId;
    if (data.veterinarianId !== undefined) changes.veterinarianId = data.veterinarianId;
    if (data.unitPriceCents !== undefined) changes.unitPriceCents = data.unitPriceCents;
    if (data.paidDirectlyByClient !== undefined) changes.paidDirectlyByClient = data.paidDirectlyByClient;

    if (issued) {
      requireSubjects({
        animalIds: changes.animalIds ?? existing.animalIds,
        lotSize: changes.lotSize !== undefined ? changes.lotSize : existing.lotSize,
      });
    }

    return this.repo.update(ctx, id, changes);
  }

  /** `draft → requested`. Daqui em diante o pedido tem que estar completo. */
  async issue(ctx: RequestContext, id: UUID): Promise<ExamRequest> {
    const existing = await this.requireExam(ctx, id);
    if (existing.status !== 'draft') throw AppError.conflict('Pedido já foi emitido');

    requireSubjects(existing);
    validateProtocolData(existing.protocolFields, existing.protocolData, { requireMandatory: true });

    const updated = await this.repo.advance(ctx, id, ['draft'], { status: 'requested' });
    return updated ?? this.changedConcurrently();
  }

  /**
   * `requested → collected`. Fecha a cobrança com a coleta (mão de obra, km
   * e — se o cliente paga o laboratório — insumos) e publica a baixa dos
   * insumos. A data prevista conta a partir da coleta.
   */
  async registerCollection(
    ctx: RequestContext,
    id: UUID,
    data: RegisterExamCollectionInput,
  ): Promise<ExamRequest> {
    const existing = await this.requireExam(ctx, id);
    if (existing.status !== 'requested') {
      throw AppError.conflict(
        existing.status === 'draft' ? 'Emita o pedido antes de registrar a coleta' : 'Coleta já registrada ou etapa já passou',
      );
    }

    const collectedAt = new Date(data.collectedAt);
    const items = (data.items ?? []).map(toItemData);
    const collection: CollectionCost = {
      laborCents: data.laborCents ?? 0,
      displacementKm: data.displacementKm ?? 0,
      displacementRateCents: data.displacementRateCents ?? 0,
      items,
    };
    const turnaround = await this.turnaroundDays(ctx, existing);

    const updated = await this.repo.advance(
      ctx,
      id,
      ['requested'],
      {
        status: 'collected',
        material: data.material,
        collectedAt,
        laborCents: collection.laborCents,
        displacementKm: collection.displacementKm,
        displacementRateCents: collection.displacementRateCents,
        chargedAt: new Date(),
        expectedResultAt: calculateExpectedResultAt(collectedAt, turnaround),
      },
      {
        items,
        finalize: (locked) => this.closeCharge(ctx, locked, collection, { stockOut: items.length > 0 }),
      },
    );
    return updated ?? this.changedConcurrently();
  }

  /**
   * `requested | collected → in_analysis`. Saindo de `requested`, outra
   * pessoa colheu: a cobrança fecha aqui, sem coleta na conta, e a data
   * prevista conta a partir do envio.
   */
  async sendToAnalysis(ctx: RequestContext, id: UUID): Promise<ExamRequest> {
    const existing = await this.requireExam(ctx, id);

    if (existing.status === 'collected') {
      const updated = await this.repo.advance(ctx, id, ['collected'], { status: 'in_analysis' });
      return updated ?? this.changedConcurrently();
    }
    if (existing.status !== 'requested') {
      throw AppError.conflict(
        existing.status === 'draft' ? 'Emita o pedido antes de enviá-lo ao laboratório' : 'Pedido já está em análise ou com resultado',
      );
    }

    const now = new Date();
    const turnaround = await this.turnaroundDays(ctx, existing);
    const updated = await this.repo.advance(
      ctx,
      id,
      ['requested'],
      { status: 'in_analysis', chargedAt: now, expectedResultAt: calculateExpectedResultAt(now, turnaround) },
      { finalize: (locked) => this.closeCharge(ctx, locked, null, { stockOut: false }) },
    );
    return updated ?? this.changedConcurrently();
  }

  /**
   * RF-EXM-005. Aceita pular etapas (o vet pode não ter marcado o envio) e
   * reanexar (correção do arquivo). Ainda em `requested`, fecha a cobrança
   * como no envio ao laboratório.
   */
  async attachResult(ctx: RequestContext, id: UUID, resultFileUrl: string): Promise<ExamRequest> {
    const existing = await this.requireExam(ctx, id);
    if (existing.status === 'draft') throw AppError.conflict('Emita o pedido antes de anexar o resultado');

    const now = new Date();
    const data = { status: 'result_available' as const, resultFileUrl, resultUploadedAt: now };

    const updated =
      existing.status === 'requested'
        ? await this.repo.advance(
            ctx,
            id,
            ['requested'],
            { ...data, chargedAt: now },
            { finalize: (locked) => this.closeCharge(ctx, locked, null, { stockOut: false }) },
          )
        : await this.repo.advance(ctx, id, [existing.status], data);
    return updated ?? this.changedConcurrently();
  }

  /**
   * Pedido que não gerou pendência some em silêncio. Pedido com pendência
   * publica `exam.deleted` e o MS6 a cancela. Estoque não volta: o insumo
   * foi de fato usado.
   */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.requireExam(ctx, id);
    const event = generatedPendency(existing) ? buildExamDeletedEvent(ctx, existing) : null;
    await this.repo.softDelete(
      ctx,
      id,
      { status: existing.status, charged: existing.chargedAt !== null },
      event,
    );
  }

  /**
   * Calculado sobre o pedido já travado (ver ExamRepository.advance). Total 0
   * — cliente pagou o laboratório e o vet não colheu — fecha a cobrança sem
   * publicar nada: não há pendência a abrir.
   */
  private closeCharge(
    ctx: RequestContext,
    locked: ExamRequest,
    collection: CollectionCost | null,
    opts: { stockOut: boolean },
  ): { data: { totalCents: number }; events: DomainEvent<unknown>[] } {
    const totalCents = calculateExamChargeCents({
      paidDirectlyByClient: locked.paidDirectlyByClient,
      unitPriceCents: locked.unitPriceCents,
      subjects: countSubjects(locked),
      collection,
    });
    const charged = { ...locked, totalCents };

    const events: DomainEvent<unknown>[] = [];
    if (opts.stockOut) events.push(buildExamCollectedEvent(ctx, charged));
    if (totalCents > 0) events.push(buildExamChargedEvent(ctx, charged));
    return { data: { totalCents }, events };
  }

  /** O tipo pode ter sido excluído depois do pedido — o prazo dele ainda vale. */
  private async turnaroundDays(ctx: RequestContext, exam: ExamRequest): Promise<number | null> {
    const type = await this.types.findById(ctx, exam.examTypeId, { includeDeleted: true });
    return type?.expectedTurnaroundDays ?? null;
  }

  private async requireExam(ctx: RequestContext, id: UUID): Promise<ExamRequest> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Pedido de exame não encontrado');
    return existing;
  }

  private changedConcurrently(): never {
    throw AppError.conflict('Pedido mudou de estado ou foi excluído — tente de novo');
  }
}

/** RF-EXM-001: "animais OU lote" — ao menos um dos dois. */
function requireSubjects(exam: Pick<ExamRequest, 'animalIds' | 'lotSize'>): void {
  if (countSubjects(exam) === 0) {
    throw AppError.validation('Pedido sem animais', [
      { field: 'animalIds', message: 'Informe ao menos um animal ou um lote' },
    ]);
  }
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function toItemData(item: ExamRequestItemInput): ExamRequestItemData {
  return {
    productId: item.productId,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: calculateItemTotalCents(item.quantity, item.unitPriceCents),
  };
}
