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
 * A chave de idempotência dos eventos mora em shared-middlewares (MS3, MS4 e
 * MS6 usam a mesma). Reexportada aqui para os imports do MS3 não mudarem.
 */
export { deriveEventIdempotencyKey } from '@quironequine/shared-middlewares';
