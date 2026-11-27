/**
 * CPF ou CNPJ do proprietário (pessoa física ou jurídica, como um haras).
 *
 * Aceita o documento com ou sem máscara e devolve o formato canônico —
 * `000.000.000-00` ou `XX.XXX.XXX/XXXX-00`, letras maiúsculas. Gravar sempre
 * o canônico é o que faz o UNIQUE (tenant_id, cpf_cnpj) recusar o mesmo
 * documento escrito de dois jeitos.
 *
 * CNPJ alfanumérico (Receita Federal, IN RFB 2.229/2024, em vigor desde
 * jul/2026): as 12 primeiras posições aceitam letras; os 2 dígitos
 * verificadores continuam numéricos. O cálculo é o mesmo módulo 11, com o
 * valor de cada caractere = código ASCII − 48 (0–9 continuam 0–9; A = 17,
 * B = 18, ...). Os CNPJs só numéricos seguem válidos sem mudança.
 */

export type DocumentKind = 'cpf' | 'cnpj';

export interface ParsedDocument {
  kind: DocumentKind;
  /** Formato canônico, pronto para gravar. */
  formatted: string;
}

const CPF_WEIGHTS_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_WEIGHTS_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Devolve o documento canônico, ou `null` se não for CPF nem CNPJ válido. */
export function parseCpfCnpj(input: string): ParsedDocument | null {
  const raw = input.replace(/[.\-/\s]/g, '').toUpperCase();

  if (/^\d{11}$/.test(raw)) {
    if (allSame(raw) || !checkDigits(raw, CPF_WEIGHTS_1, CPF_WEIGHTS_2)) return null;
    return { kind: 'cpf', formatted: `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}` };
  }

  if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) {
    if (allSame(raw) || !checkDigits(raw, CNPJ_WEIGHTS_1, CNPJ_WEIGHTS_2)) return null;
    return {
      kind: 'cnpj',
      formatted: `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`,
    };
  }

  return null;
}

/** Os dois últimos caracteres são os dígitos verificadores (módulo 11). */
function checkDigits(doc: string, weights1: number[], weights2: number[]): boolean {
  const first = mod11(doc.slice(0, weights1.length), weights1);
  const second = mod11(doc.slice(0, weights1.length) + first, weights2);
  return doc.slice(-2) === `${first}${second}`;
}

function mod11(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i]!;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** 000.000.000-00, 111.111.111-11...: passam no cálculo, mas não existem. */
function allSame(doc: string): boolean {
  return doc.split('').every((c) => c === doc[0]);
}
