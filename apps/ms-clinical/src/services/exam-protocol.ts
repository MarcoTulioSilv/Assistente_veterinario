import { z, type ZodTypeAny } from 'zod';
import type { ExamProtocolField } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';

/** Aceita 'AAAA-MM-DD' ou data-hora ISO completa. */
const dateValue = z.union([z.string().date(), z.string().datetime()]);

function valueSchema(field: ExamProtocolField): ZodTypeAny {
  switch (field.type) {
    case 'text':
      return z.string().max(1000);
    case 'number':
      return z.number().finite();
    case 'date':
      return dateValue;
    case 'select':
      return z.enum((field.options ?? []) as [string, ...string[]]);
  }
}

/** Vazio = "não preenchido": rascunho pode ter campo em branco. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * RF-EXM-002: valida os valores do protocolo contra os campos do pedido.
 *
 * Sempre: chave desconhecida e valor do tipo errado são rejeitados — o
 * pedido não pode carregar lixo que o laudo depois não explica. Já os
 * campos obrigatórios só são cobrados com `requireMandatory` (ao emitir o
 * pedido): o rascunho pode ser salvo pela metade.
 *
 * Devolve os valores sem os campos em branco.
 */
export function validateProtocolData(
  fields: ExamProtocolField[],
  data: Record<string, unknown>,
  options: { requireMandatory: boolean },
): Record<string, unknown> {
  const known = new Map(fields.map((field) => [field.key, field]));
  const details: Array<{ field: string; message: string }> = [];
  const clean: Record<string, unknown> = {};

  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      details.push({ field: `protocolData.${key}`, message: 'Campo não existe no protocolo deste exame' });
    }
  }

  for (const field of fields) {
    const value = data[field.key];

    if (isBlank(value)) {
      if (options.requireMandatory && field.required) {
        details.push({ field: `protocolData.${field.key}`, message: `${field.label} é obrigatório` });
      }
      continue;
    }

    const result = valueSchema(field).safeParse(value);
    if (!result.success) {
      details.push({
        field: `protocolData.${field.key}`,
        message: `${field.label}: ${result.error.issues[0]?.message ?? 'valor inválido'}`,
      });
      continue;
    }
    clean[field.key] = result.data;
  }

  if (details.length > 0) {
    throw AppError.validation('Campos do protocolo inválidos', details);
  }
  return clean;
}
