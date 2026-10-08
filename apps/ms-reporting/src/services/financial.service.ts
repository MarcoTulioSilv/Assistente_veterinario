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
import {
  appointmentDonePayloadSchema,
  appointmentDeletedPayloadSchema,
  examChargedPayloadSchema,
  examDeletedPayloadSchema,
  vaccinationAppliedPayloadSchema,
  vaccinationDeletedPayloadSchema,
  type ListFinancialRecordsInput,
} from '../schemas/financial.schema';

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
      if (existing.status === 'cancelled') {
        throw AppError.conflict('Pendência cancelada — o atendimento, exame ou vacinação de origem foi excluído');
      }
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

  /** Disparado por `appointment.deleted`/`exam.deleted`, idempotente e independente de ordem. */
  async cancelBySource(
    ctx: RequestContext,
    data: CreateFinancialRecordDto,
    idempotencyKey: UUID,
  ): Promise<void> {
    const outcome = await this.repo.cancelBySource(ctx, data, idempotencyKey);

    if (outcome === 'kept-received') {
      // Não é erro: a regra é não apagar dinheiro recebido. Mas é o caso que
      // alguém do financeiro vai querer achar depois (possível estorno).
      log.warn(
        { sourceType: data.sourceType, sourceId: data.sourceId },
        'Origem excluída já estava PAGA — registro de pagamento mantido',
      );
      return;
    }

    log.info({ sourceType: data.sourceType, sourceId: data.sourceId, outcome }, 'Pendência cancelada');
  }

  /**
   * A fila `domain-events-reporting` é só deste serviço, mas recebe todo
   * evento que ele assina — o roteamento por nome fica aqui, na camada de
   * negócio, testável sem broker.
   *
   * A chave de idempotência é a do próprio envelope: um `appointment.done`
   * gera exatamente uma pendência, e um `appointment.deleted` exatamente um
   * cancelamento. Não precisa derivar por item como o MS2 faz, porque aqui
   * não há array — é um valor só, o total do atendimento.
   */
  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    if (jobName === EVENTS.APPOINTMENT_DONE) return this.onAppointmentDone(event);
    if (jobName === EVENTS.APPOINTMENT_DELETED) return this.onAppointmentDeleted(event);
    if (jobName === EVENTS.EXAM_CHARGED) return this.onExamCharged(event);
    if (jobName === EVENTS.EXAM_DELETED) return this.onExamDeleted(event);
    if (jobName === EVENTS.VACCINATION_APPLIED) return this.onVaccinationApplied(event);
    if (jobName === EVENTS.VACCINATION_DELETED) return this.onVaccinationDeleted(event);
  }

  /** RN-002: abre a pendência financeira (ADR-001 §5.3). */
  private async onAppointmentDone(event: DomainEvent<unknown>): Promise<void> {
    const payload = appointmentDonePayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.recordPending(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'appointment',
        sourceId: payload.appointmentId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt ?? event.occurredAt,
      },
      event.idempotencyKey,
    );

    log.info(
      { appointmentId: payload.appointmentId, amountCents: payload.totalCostCents },
      'Pendência financeira aberta a partir do atendimento',
    );
  }

  /** Atendimento finalizado excluído → cancela a pendência dele. */
  private async onAppointmentDeleted(event: DomainEvent<unknown>): Promise<void> {
    const payload = appointmentDeletedPayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.cancelBySource(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'appointment',
        sourceId: payload.appointmentId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt,
      },
      event.idempotencyKey,
    );
  }

  /**
   * RN-002 para exame. O MS3 só publica quando a cobrança fecha com valor —
   * cliente que pagou o laboratório direto e não teve coleta do vet não gera
   * evento nenhum.
   */
  private async onExamCharged(event: DomainEvent<unknown>): Promise<void> {
    const payload = examChargedPayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.recordPending(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'exam',
        sourceId: payload.examRequestId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt,
      },
      event.idempotencyKey,
    );

    log.info(
      { examRequestId: payload.examRequestId, amountCents: payload.totalCostCents },
      'Pendência financeira aberta a partir do exame',
    );
  }

  /** Pedido de exame com cobrança excluído → cancela a pendência dele. */
  private async onExamDeleted(event: DomainEvent<unknown>): Promise<void> {
    const payload = examDeletedPayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.cancelBySource(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'exam',
        sourceId: payload.examRequestId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt,
      },
      event.idempotencyKey,
    );
  }

  /**
   * RN-002 para vacinação. O evento é o mesmo que o MS2 usa pra baixar o
   * estoque, então chega mesmo quando a aplicação não custou nada — e aí
   * não há pendência a abrir (o MS3 também não publica a exclusão dela).
   */
  private async onVaccinationApplied(event: DomainEvent<unknown>): Promise<void> {
    const payload = vaccinationAppliedPayloadSchema.parse(event.payload);
    if (payload.totalCostCents === 0) {
      log.info({ vaccinationId: payload.vaccinationId }, 'Vacinação sem custo — nenhuma pendência aberta');
      return;
    }
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.recordPending(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'vaccination',
        sourceId: payload.vaccinationId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt,
      },
      event.idempotencyKey,
    );

    log.info(
      { vaccinationId: payload.vaccinationId, amountCents: payload.totalCostCents },
      'Pendência financeira aberta a partir da vacinação',
    );
  }

  /** Vacinação com cobrança excluída → cancela a pendência dela. */
  private async onVaccinationDeleted(event: DomainEvent<unknown>): Promise<void> {
    const payload = vaccinationDeletedPayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    await this.cancelBySource(
      ctx,
      {
        ownerId: payload.ownerId,
        sourceType: 'vaccination',
        sourceId: payload.vaccinationId,
        amountCents: payload.totalCostCents,
        occurredAt: payload.performedAt,
      },
      event.idempotencyKey,
    );
  }
}
