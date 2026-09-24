import { createHash } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type {
  IFinancialService,
  RequestContext,
  UUID,
  Paginated,
  FinancialRecord,
  FinancialSourceType,
  CreateFinancialRecordDto,
  PaymentRegisteredPayload,
  DomainEvent,
} from '@quironequine/shared-types';
import { AppError, createServiceLogger } from '@quironequine/shared-middlewares';
import type { FinancialRepository } from '../repositories/financial.repository';
import { appointmentDonePayloadSchema, type ListFinancialRecordsInput } from '../schemas/financial.schema';

const log = createServiceLogger('financial-service');
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

function systemCtx(tenantId: UUID, traceId: string): RequestContext {
  return { tenantId, userId: SYSTEM_USER_ID, role: 'admin', plan: 'plus', traceId };
}

/**
 * Chave do envelope derivada do registro financeiro — mesma técnica do MS3.
 * Publicar duas vezes o mesmo pagamento gera a mesma chave, e o jobId do
 * BullMQ descarta a segunda. SHA-1 formatado como UUID pra não puxar o
 * pacote `uuid`, que o projeto evita desde o CVE via node-cron.
 */
export function derivePaymentEventKey(financialRecordId: string): UUID {
  const hex = createHash('sha1')
    .update(`${EVENTS.PAYMENT_REGISTERED}:${financialRecordId}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function buildPaymentRegisteredEvent(
  ctx: RequestContext,
  record: FinancialRecord,
): DomainEvent<PaymentRegisteredPayload> {
  return {
    name: EVENTS.PAYMENT_REGISTERED,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: derivePaymentEventKey(record.id),
    occurredAt: new Date().toISOString(),
    payload: {
      financialRecordId: record.id,
      ownerId: record.ownerId,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      amountCents: record.amountCents,
      paidAt: record.paidAt ?? new Date().toISOString(),
    },
  };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a IFinancialService publicada em shared-types.
 *
 * Fatia antecipada do MS6 (ver cabeçalho do schema): só a pendência
 * financeira. Fluxo de caixa, dashboard e configurações seguem no M3.
 */
export class FinancialService implements IFinancialService {
  constructor(
    private readonly repo: FinancialRepository,
    private readonly publish: (event: DomainEvent<unknown>) => Promise<void>,
  ) {}

  async list(ctx: RequestContext, params: ListFinancialRecordsInput): Promise<Paginated<FinancialRecord>> {
    return this.repo.list(ctx, params);
  }

  /** RF-ATD-008 */
  async listByOwner(
    ctx: RequestContext,
    ownerId: UUID,
    params: ListFinancialRecordsInput,
  ): Promise<Paginated<FinancialRecord>> {
    return this.repo.listByOwner(ctx, ownerId, params);
  }

  async findBySource(
    ctx: RequestContext,
    sourceType: FinancialSourceType,
    sourceId: UUID,
  ): Promise<FinancialRecord | null> {
    return this.repo.findBySource(ctx, sourceType, sourceId);
  }

  /**
   * RN-002: única transição para `received`.
   *
   * O evento é publicado DEPOIS do commit, e sem outbox (ver publisher.ts):
   * se a publicação falhar, o pagamento continua registrado — que é o fato
   * de negócio — e só a notificação se perde. Por isso a falha é registrada
   * em log e não derruba a chamada: estourar aqui faria o usuário achar que
   * o pagamento não foi registrado, e uma segunda tentativa devolveria
   * "já recebido".
   */
  async registerPayment(ctx: RequestContext, id: UUID): Promise<FinancialRecord> {
    const updated = await this.repo.markReceived(ctx, id, new Date());

    if (!updated) {
      const existing = await this.repo.findById(ctx, id);
      if (!existing) throw AppError.notFound('Registro financeiro não encontrado');
      throw AppError.conflict('Pagamento já registrado');
    }

    try {
      await this.publish(buildPaymentRegisteredEvent(ctx, updated));
    } catch (err) {
      log.error(
        { err, financialRecordId: updated.id, traceId: ctx.traceId },
        'Pagamento registrado, mas falhou ao publicar payment.registered — proprietário não será notificado',
      );
    }

    return updated;
  }

  /** Disparado por evento do broker, idempotente (ADR-001 §5.4). */
  async recordPending(
    ctx: RequestContext,
    data: CreateFinancialRecordDto,
    idempotencyKey: UUID,
  ): Promise<void> {
    await this.repo.recordPending(ctx, data, idempotencyKey);
  }

  /**
   * RN-002: consome `appointment.done` e abre a pendência financeira
   * (ADR-001 §5.3). A fila `domain-events-reporting` é só deste serviço,
   * mas recebe todo evento que ele assina — o filtro por nome fica aqui,
   * na camada de negócio, testável sem broker.
   *
   * A chave de idempotência é a do próprio envelope: um evento
   * `appointment.done` gera exatamente uma pendência. Não precisa derivar
   * por item como o MS2 faz, porque aqui não há array — é um valor só, o
   * total do atendimento.
   */
  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    if (jobName !== EVENTS.APPOINTMENT_DONE) return;

    const payload = appointmentDonePayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.recordPending(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'appointment',
        sourceId: payload.appointmentId,
        amountCents: payload.totalCostCents,
        occurredAt: event.occurredAt,
      },
      event.idempotencyKey,
    );

    log.info(
      { appointmentId: payload.appointmentId, amountCents: payload.totalCostCents },
      'Pendência financeira aberta a partir do atendimento',
    );
  }
}
