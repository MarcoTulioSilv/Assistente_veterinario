import { createHash } from 'node:crypto';
import type { UUID } from '@quironequine/shared-types';

/**
 * Regras de valor e de chave de evento comuns a atendimento e exame — o
 * exame reaproveita as mesmas (RF-EXM-006 tem a mesma estrutura de custo do
 * RF-ATD-006), e viver aqui evita que um serviço dependa do outro.
 */

interface BudgetInput {
  items: Array<{ totalCents: number }>;
  laborCents: number;
  displacementKm: number;
  displacementRateCents: number;
}

/**
 * Itens + mão de obra + deslocamento (km × valor/km). Tudo em centavos
 * inteiros (ADR-001 §5.6) — o arredondamento do deslocamento acontece uma
 * vez, no fim, e não por km.
 */
export function calculateTotalCents(input: BudgetInput): number {
  const itemsCents = input.items.reduce((sum, item) => sum + item.totalCents, 0);
  const displacementCents = Math.round(input.displacementKm * input.displacementRateCents);
  return itemsCents + input.laborCents + displacementCents;
}

export function calculateItemTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * Chave de idempotência do envelope, derivada da origem (atendimento,
 * exame…) — nunca aleatória.
 *
 * É o outro lado do problema documentado no DeductionService do MS2: lá, a
 * proteção cobre reentrega do MESMO evento (retry do BullMQ), mas não um
 * publisher que emita dois eventos com chaves diferentes pra mesma origem.
 * Derivando do id, "dois eventos pra mesma origem" deixa de ser possível: a
 * segunda gravação no outbox esbarra na UNIQUE de idempotency_key.
 *
 * SHA-1 formatado como UUID pelo mesmo motivo do MS2 — `idempotency_key` é
 * coluna `@db.Uuid` de verdade, e o projeto evita o pacote `uuid`.
 */
export function deriveEventIdempotencyKey(eventName: string, sourceId: string): UUID {
  const hex = createHash('sha1').update(`${eventName}:${sourceId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
