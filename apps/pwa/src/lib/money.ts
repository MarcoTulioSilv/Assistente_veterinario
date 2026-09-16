/** Formata centavos como BRL (ex: 12345 -> "R$ 123,45"). ADR-001 §5.6: dinheiro é sempre Cents. */
export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte o texto digitado num campo de dinheiro (aceita "123,45" ou "123.45") pra centavos. */
export function parseBRLToCents(value: string): number | undefined {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  if (!normalized) return undefined;
  const amount = Number(normalized);
  if (Number.isNaN(amount)) return undefined;
  return Math.round(amount * 100);
}

/** Converte texto tipo "12,5" ou "" em number|undefined ('' = não preenchido, deixa o backend usar o default). */
export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const amount = Number(trimmed.replace(',', '.'));
  return Number.isNaN(amount) ? undefined : amount;
}
