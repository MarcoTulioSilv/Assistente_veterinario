import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { PendingOutboxRow } from '../repositories/outbox.repository';

const log = createServiceLogger('outbox-relay');

export interface OutboxRelayDeps {
  fetchPending(limit: number): Promise<PendingOutboxRow[]>;
  publish(event: DomainEvent<unknown>): Promise<void>;
  markPublished(tenantId: string, id: string): Promise<void>;
  markFailed(tenantId: string, id: string, error: string): Promise<void>;
}

export interface DrainResult {
  published: number;
  failed: number;
}

/**
 * Um ciclo do relay: lê os eventos pendentes e publica cada um.
 *
 * **Entrega ao menos uma vez, de propósito.** A ordem é publicar e só
 * depois marcar; se o processo morrer entre as duas coisas, a linha
 * continua pendente e será republicada no próximo ciclo. Isso é seguro
 * porque o `jobId` no BullMQ é a `idempotencyKey` do envelope (o job
 * duplicado é descartado) e porque os consumidores são idempotentes por
 * exigência do ADR-001 §5.4. O inverso — marcar antes de publicar —
 * perderia o evento em silêncio, que é exatamente o que o outbox existe
 * pra impedir.
 *
 * Uma falha não interrompe o lote: o erro é registrado na linha e o
 * relay segue para as demais. A linha falha continua pendente.
 */
export async function drainOutboxOnce(deps: OutboxRelayDeps, limit = 50): Promise<DrainResult> {
  const pending = await deps.fetchPending(limit);
  const result: DrainResult = { published: 0, failed: 0 };

  for (const row of pending) {
    try {
      await deps.publish(row.event);
      await deps.markPublished(row.tenantId, row.id);
      result.published += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { outboxId: row.id, event: row.event.name, attempts: row.attempts, err },
        'Falha ao publicar evento do outbox — segue pendente para o próximo ciclo',
      );
      await deps.markFailed(row.tenantId, row.id, message);
    }
  }

  if (result.published > 0 || result.failed > 0) {
    log.info(result, 'Ciclo do outbox concluído');
  }

  return result;
}
