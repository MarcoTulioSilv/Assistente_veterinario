import { createHash } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent, IStockService, RequestContext, UUID } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import { appointmentDonePayloadSchema } from '../schemas/appointment-done.schema';

const log = createServiceLogger('deduction-service');
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

function systemCtx(tenantId: UUID, traceId: string): RequestContext {
  return { tenantId, userId: SYSTEM_USER_ID, role: 'admin', plan: 'plus', traceId };
}

/**
 * Deriva uma chave de idempotência estável por item dentro de um mesmo
 * evento — `AppointmentDonePayload.consumedItems` é um array, mas
 * `StockMovement.idempotencyKey` é uma coluna UNIQUE por linha, e o
 * envelope do evento só carrega UMA chave. Deriva por ÍNDICE, não por
 * conteúdo (productId+quantity): duas entradas idênticas de conteúdo
 * (o mesmo produto administrado duas vezes no mesmo atendimento)
 * gerariam a mesma chave com hash de conteúdo, e a segunda viraria
 * no-op silencioso — sub-baixa de estoque. Índice garante uma chave
 * distinta por posição, estável entre reentregas do mesmo evento (a
 * ordem do array é preservada por JSON/Redis/BullMQ).
 *
 * SHA-1 formatado como UUID em vez do pacote `uuid` — mesmo motivo já
 * documentado em alert-scheduler.ts pra evitar essa dependência
 * (puxava um `uuid` vulnerável via node-cron). `idempotency_key` é
 * coluna `@db.Uuid` de verdade — precisa ser um UUID sintaticamente
 * válido (8-4-4-4-12 hex), não qualquer string; o Postgres não exige
 * conformidade estrita de versão/variante RFC4122, só o formato.
 *
 * Limite explícito: protege contra reentrega do MESMO evento (mesmo
 * idempotencyKey de envelope, ex. retry do BullMQ após crash). Não
 * protege contra um futuro publisher (ms-clinical) gerar dois eventos
 * com idempotencyKeys diferentes pro mesmo atendimento real — isso só
 * se resolve do lado de quem publica.
 */
export function deriveItemIdempotencyKey(envelopeIdempotencyKey: string, index: number): UUID {
  const hex = createHash('sha1').update(`${envelopeIdempotencyKey}:${index}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 * RN-003: consome appointment.done do broker e baixa estoque via
 * IStockService.deduct(), um item por vez.
 *
 * A fila `domain-events` é compartilhada (ver events/deduction-consumer.ts,
 * que só faz a parte de plumbing BullMQ) — jobs de outro tipo são
 * ignorados AQUI, na camada de negócio, não na de plumbing, pra manter
 * isto testável sem precisar de um broker de verdade.
 */
export class DeductionService {
  constructor(private readonly stock: IStockService) {}

  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    if (jobName !== EVENTS.APPOINTMENT_DONE) return;

    const payload = appointmentDonePayloadSchema.parse(event.payload);
    const ctx = systemCtx(event.tenantId, event.traceId);

    const errors: unknown[] = [];
    for (const [index, item] of payload.consumedItems.entries()) {
      try {
        await this.stock.deduct(
          ctx,
          item.productId,
          item.quantity,
          deriveItemIdempotencyKey(event.idempotencyKey, index),
          { referenceId: payload.appointmentId, referenceType: 'appointment' },
        );
      } catch (err) {
        log.error(
          { err, appointmentId: payload.appointmentId, productId: item.productId, index },
          'Falha ao baixar item do atendimento',
        );
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      // Itens que já tiveram sucesso são no-op garantido num retry do
      // BullMQ (mesma chave derivada, mesmo tratamento de P2002 que
      // MovementRepository.record() já faz) — falhar o evento inteiro
      // e deixar o BullMQ tentar de novo é seguro, não duplica baixa.
      throw new AggregateError(
        errors,
        `Falha ao baixar ${errors.length} de ${payload.consumedItems.length} item(ns) do atendimento ${payload.appointmentId}`,
      );
    }
  }
}
