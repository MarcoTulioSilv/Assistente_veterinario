import type {
  ExamRequest as PrismaExamRequest,
  ExamRequestAnimal as PrismaExamAnimal,
  ExamRequestItem as PrismaExamItem,
  ExamStatus as PrismaExamStatus,
} from '../../node_modules/.prisma/client-clinical';
import type {
  RequestContext,
  UUID,
  Paginated,
  ExamRequest,
  ExamRequestItem,
  ExamProtocolField,
  ExamStatus,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { prisma, withTenant } from '../prisma';
import { enqueueOutboxEvent } from './outbox.repository';
import type { ListExamRequestsInput } from '../schemas/exam.schema';

export interface ExamRequestItemData {
  productId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Já com o snapshot do tipo resolvido pelo service. */
export interface CreateExamRequestData {
  ownerId: string;
  propertyId: string;
  veterinarianId: string;
  examTypeId: string;
  examTypeName: string;
  protocolFields: ExamProtocolField[];
  protocolData: Record<string, unknown>;
  animalIds: string[];
  lotDescription: string | null;
  lotSize: number | null;
  unitPriceCents: number;
  paidDirectlyByClient: boolean;
}

export type UpdateExamRequestData = Partial<Omit<CreateExamRequestData, 'ownerId'>>;

/** Campos que um avanço de status pode gravar. */
export interface ExamAdvanceData {
  status: ExamStatus;
  material?: string;
  collectedAt?: Date;
  laborCents?: number;
  displacementKm?: number;
  displacementRateCents?: number;
  totalCents?: number;
  chargedAt?: Date;
  expectedResultAt?: Date | null;
  resultFileUrl?: string;
  resultUploadedAt?: Date;
}

/** O que o lembrete precisa de cada pedido — nada além disso. */
export interface DueExamRow {
  id: string;
  tenantId: string;
  ownerId: string;
  veterinarianId: string;
  examTypeName: string;
  expectedResultAt: Date;
}

interface DueExamSqlRow {
  id: string;
  tenant_id: string;
  owner_id: string;
  veterinarian_id: string;
  exam_type_name: string;
  expected_result_at: Date;
}

const INCLUDE = { animals: true, items: true } as const;

/** Enquanto a cobrança não fechou, o pedido ainda pode ser editado. */
const EDITABLE_STATUSES: PrismaExamStatus[] = ['draft', 'requested'];

type ExamRow = PrismaExamRequest & { animals: PrismaExamAnimal[]; items: PrismaExamItem[] };

/**
 * Pedidos de exame — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2), exceto a
 * leitura do lembrete, que é cross-tenant por função SECURITY DEFINER.
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class ExamRepository {
  async list(ctx: RequestContext, params: ListExamRequestsInput): Promise<Paginated<ExamRequest>> {
    return this.paginate(ctx, params, {});
  }

  /** RF-CAD-026. Pedido só por lote não tem animal, então não aparece aqui. */
  async listByAnimal(
    ctx: RequestContext,
    animalId: UUID,
    params: ListExamRequestsInput,
  ): Promise<Paginated<ExamRequest>> {
    return this.paginate(ctx, params, { animals: { some: { animalId } } });
  }

  private async paginate(
    ctx: RequestContext,
    params: ListExamRequestsInput,
    filter: Record<string, unknown>,
  ): Promise<Paginated<ExamRequest>> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = { deletedAt: null, ...filter };
      const [rows, total] = await Promise.all([
        tx.examRequest.findMany({ where, include: INCLUDE, skip, take: limit, orderBy: { createdAt: 'desc' } }),
        tx.examRequest.count({ where }),
      ]);
      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<ExamRequest | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.examRequest.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
      return row ? toDomain(row) : null;
    });
  }

  async create(ctx: RequestContext, data: CreateExamRequestData): Promise<ExamRequest> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.examRequest.create({
        data: {
          tenantId: ctx.tenantId,
          ownerId: data.ownerId,
          propertyId: data.propertyId,
          veterinarianId: data.veterinarianId,
          examTypeId: data.examTypeId,
          examTypeName: data.examTypeName,
          protocolFields: data.protocolFields as unknown as object[],
          protocolData: data.protocolData as object,
          lotDescription: data.lotDescription,
          lotSize: data.lotSize,
          unitPriceCents: data.unitPriceCents,
          paidDirectlyByClient: data.paidDirectlyByClient,
          animals: { create: data.animalIds.map((animalId) => ({ tenantId: ctx.tenantId, animalId })) },
        },
        include: INCLUDE,
      });
      return toDomain(row);
    });
  }

  /**
   * Só enquanto a cobrança não fechou. O primeiro UPDATE é a trava: ele
   * confere o status E segura a linha, então uma coleta registrada em
   * paralelo espera — sem isso, o preço poderia mudar depois de o total já
   * ter sido congelado com o preço antigo.
   */
  async update(ctx: RequestContext, id: UUID, data: UpdateExamRequestData): Promise<ExamRequest> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.examRequest.updateMany({
        where: { id, status: { in: EDITABLE_STATUSES }, chargedAt: null, deletedAt: null },
        data: { updatedAt: new Date() },
      });
      if (count === 0) throw AppError.conflict('Pedido não pode mais ser editado — a cobrança já fechou');

      if (data.animalIds) await tx.examRequestAnimal.deleteMany({ where: { examRequestId: id } });

      const row = await tx.examRequest.update({
        where: { id },
        data: {
          ...(data.propertyId !== undefined ? { propertyId: data.propertyId } : {}),
          ...(data.veterinarianId !== undefined ? { veterinarianId: data.veterinarianId } : {}),
          ...(data.examTypeId !== undefined ? { examTypeId: data.examTypeId } : {}),
          ...(data.examTypeName !== undefined ? { examTypeName: data.examTypeName } : {}),
          ...(data.protocolFields !== undefined
            ? { protocolFields: data.protocolFields as unknown as object[] }
            : {}),
          ...(data.protocolData !== undefined ? { protocolData: data.protocolData as object } : {}),
          ...(data.lotDescription !== undefined ? { lotDescription: data.lotDescription } : {}),
          ...(data.lotSize !== undefined ? { lotSize: data.lotSize } : {}),
          ...(data.unitPriceCents !== undefined ? { unitPriceCents: data.unitPriceCents } : {}),
          ...(data.paidDirectlyByClient !== undefined ? { paidDirectlyByClient: data.paidDirectlyByClient } : {}),
          ...(data.animalIds
            ? { animals: { create: data.animalIds.map((animalId) => ({ tenantId: ctx.tenantId, animalId })) } }
            : {}),
        },
        include: INCLUDE,
      });
      return toDomain(row);
    });
  }

  /**
   * Avança o status — e, junto, grava campos, insumos e eventos do outbox NA
   * MESMA TRANSAÇÃO (ADR-002): ou o pedido avança E a baixa/cobrança vão
   * sair, ou nada acontece.
   *
   * O UPDATE é condicionado aos status de origem: duas requisições
   * concorrentes (ex.: registrar a coleta e mandar pra análise) não fecham a
   * cobrança duas vezes. Devolve `null` se o pedido não estava num dos
   * status esperados — o service decide a mensagem.
   *
   * `finalize` recebe o pedido JÁ TRAVADO por este UPDATE e devolve o que
   * depende dele (total da cobrança, eventos). Calcular com a leitura feita
   * antes da transação deixaria escapar uma edição de preço concorrente: ela
   * comitaria entre a leitura e o UPDATE, e o total congelado seria o velho.
   */
  async advance(
    ctx: RequestContext,
    id: UUID,
    from: ExamStatus[],
    data: ExamAdvanceData,
    extras: {
      items?: ExamRequestItemData[];
      finalize?: (locked: ExamRequest) => { data?: Partial<ExamAdvanceData>; events?: DomainEvent<unknown>[] };
    } = {},
  ): Promise<ExamRequest | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.examRequest.updateMany({
        where: { id, status: { in: from as PrismaExamStatus[] }, deletedAt: null },
        data,
      });
      if (count === 0) return null;

      if (extras.items?.length) {
        await tx.examRequestItem.createMany({
          data: extras.items.map((item) => ({ ...item, tenantId: ctx.tenantId, examRequestId: id })),
        });
      }

      if (extras.finalize) {
        const locked = await tx.examRequest.findFirstOrThrow({ where: { id }, include: INCLUDE });
        const result = extras.finalize(toDomain(locked));
        if (result.data) await tx.examRequest.update({ where: { id }, data: result.data });
        for (const event of result.events ?? []) {
          await enqueueOutboxEvent(tx, ctx.tenantId, event);
        }
      }

      const row = await tx.examRequest.findFirstOrThrow({ where: { id }, include: INCLUDE });
      return toDomain(row);
    });
  }

  /**
   * Exclusão e evento na mesma transação. Condicionado ao status E à
   * cobrança que o service viu: um pedido que teve a cobrança fechada por
   * outra requisição entre a leitura e a exclusão seria apagado SEM o
   * `exam.deleted`, e a pendência ficaria órfã.
   */
  async softDelete(
    ctx: RequestContext,
    id: UUID,
    expected: { status: ExamStatus; charged: boolean },
    event: DomainEvent<unknown> | null,
  ): Promise<void> {
    await withTenant(ctx.tenantId, async (tx) => {
      const { count } = await tx.examRequest.updateMany({
        where: {
          id,
          status: expected.status,
          chargedAt: expected.charged ? { not: null } : null,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw AppError.conflict('Pedido mudou de estado ou já foi excluído — tente de novo');
      if (event) await enqueueOutboxEvent(tx, ctx.tenantId, event);
    });
  }

  /**
   * Lembrete D-1/no dia: varre TODOS os tenants pela função SECURITY DEFINER
   * (padrão da ADR-006), não por um client sem RLS. A janela vem do service,
   * que decide o que é "hoje" no fuso de São Paulo.
   *
   * Os ::timestamptz não são decorativos: o Prisma pode mandar a data num
   * tipo que o Postgres não casa com a assinatura da função — mesmo tropeço
   * do ::int na leitura do outbox.
   */
  async listResultDueAcrossTenants(from: Date, to: Date): Promise<DueExamRow[]> {
    const rows = await prisma.$queryRaw<DueExamSqlRow[]>`
      SELECT * FROM clinical_list_exams_result_due(${from}::timestamptz, ${to}::timestamptz)
    `;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ownerId: row.owner_id,
      veterinarianId: row.veterinarian_id,
      examTypeName: row.exam_type_name,
      expectedResultAt: row.expected_result_at,
    }));
  }
}

function toItemDomain(row: PrismaExamItem): ExamRequestItem {
  return {
    id: row.id,
    productId: row.productId,
    description: row.description,
    quantity: row.quantity.toNumber(),
    unitPriceCents: row.unitPriceCents,
    totalCents: row.totalCents,
  };
}

function toDomain(row: ExamRow): ExamRequest {
  return {
    id: row.id,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    veterinarianId: row.veterinarianId,
    examTypeId: row.examTypeId,
    examTypeName: row.examTypeName,
    protocolFields: row.protocolFields as unknown as ExamProtocolField[],
    protocolData: row.protocolData as Record<string, unknown>,
    material: row.material,
    collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
    animalIds: row.animals.map((a) => a.animalId),
    lotDescription: row.lotDescription,
    lotSize: row.lotSize,
    status: row.status,
    expectedResultAt: row.expectedResultAt ? row.expectedResultAt.toISOString() : null,
    resultFileUrl: row.resultFileUrl,
    resultUploadedAt: row.resultUploadedAt ? row.resultUploadedAt.toISOString() : null,
    paidDirectlyByClient: row.paidDirectlyByClient,
    unitPriceCents: row.unitPriceCents,
    laborCents: row.laborCents,
    displacementKm: row.displacementKm.toNumber(),
    displacementRateCents: row.displacementRateCents,
    totalCents: row.totalCents,
    chargedAt: row.chargedAt ? row.chargedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toItemDomain),
  };
}
