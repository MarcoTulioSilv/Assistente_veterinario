import { createHash } from 'node:crypto';
import type { UUID } from '@quironequine/shared-types';

/**
 * Chave de idempotência do envelope de um evento, derivada da origem
 * (atendimento, pagamento, lembrete…) — nunca aleatória.
 *
 * É o outro lado do problema documentado no DeductionService do MS2: lá, a
 * proteção cobre reentrega do MESMO evento (retry do BullMQ), mas não um
 * publisher que emita dois eventos com chaves diferentes pra mesma origem.
 * Derivando da origem, "dois eventos pra mesma origem" deixa de ser
 * possível: o jobId repetido é descartado pelo BullMQ, e a segunda gravação
 * no outbox esbarra na UNIQUE de idempotency_key.
 *
 * SHA-1 formatado como UUID: `idempotency_key` é coluna `@db.Uuid` de
 * verdade, e o projeto evita o pacote `uuid`. Usada por MS3, MS4 e MS6.
 */
export function deriveEventIdempotencyKey(eventName: string, sourceId: string): UUID {
  const hex = createHash('sha1').update(`${eventName}:${sourceId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
