import type { DomainEvent } from '@quironequine/shared-types';
import { prisma, withTenant, type TenantTx } from '../prisma';

/** O que o relay precisa de cada linha pendente — nada além disso. */
export interface PendingOutboxRow {
  id: string;
  tenantId: string;
  event: DomainEvent<unknown>;
  attempts: number;
}

/** Forma crua devolvida pela função SQL (snake_case, como no banco). */
interface PendingOutboxSqlRow {
  id: string;
  tenant_id: string;
  event_name: string;
  payload: DomainEvent<unknown>;
  idempotency_key: string;
  attempts: number;
}

/**
 * Grava o evento na MESMA transação da mudança de negócio (ADR-001 §6.2).
 * Recebe o `tx` de quem chama de propósito: se abrisse transação própria,
 * a atomicidade — a razão de existir do outbox — se perderia.
 *
 * Uso:
 *   await withTenant(ctx.tenantId, async (tx) => {
 *     await tx.appointment.update(...);
 *     await enqueueOutboxEvent(tx, ctx.tenantId, event);
 *   });
 */
export async function enqueueOutboxEvent(
  tx: TenantTx,
  tenantId: string,
  event: DomainEvent<unknown>,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      tenantId,
      eventName: event.name,
      payload: event as unknown as object,
      idempotencyKey: event.idempotencyKey,
    },
  });
}

/**
 * Lê os pendentes de TODOS os tenants — o relay é infraestrutura, não
 * roda no contexto de um tenant. Vai pela função `SECURITY DEFINER`
 * estreita (ADR-002, mesmo padrão do ADR-004/006), não por um client
 * Prisma de superusuário: só leitura, só estas colunas.
 */
export async function fetchPendingOutbox(limit: number): Promise<PendingOutboxRow[]> {
  // O ::int não é decorativo: o Prisma manda número JS como bigint, e a
  // função é declarada INTEGER — sem o cast o Postgres não acha a
  // sobrecarga ("function ... (bigint) does not exist").
  const rows = await prisma.$queryRaw<PendingOutboxSqlRow[]>`
    SELECT * FROM clinical_list_pending_outbox(${limit}::int)
  `;

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    event: row.payload,
    attempts: row.attempts,
  }));
}

/**
 * Marcar não precisa de bypass de RLS: o relay já sabe o tenant de cada
 * linha, então o UPDATE entra pelo caminho normal, com a policy ativa.
 */
export async function markOutboxPublished(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } }),
  );
}

export async function markOutboxFailed(tenantId: string, id: string, error: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.outboxEvent.update({
      where: { id },
      // Continua com published_at NULL — segue pendente e o próximo
      // ciclo do relay tenta de novo.
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 2000) },
    }),
  );
}
