import type { CreateAppointmentItemDto } from '@quironequine/shared-types';
import { parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import type { AppointmentItemFormValues } from './schema';

/**
 * PONTE TEMPORÁRIA entre o formulário atual e o contrato novo do orçamento
 * (reunião com os stakeholders de 20/10/2026 — ver o cabeçalho da seção MS3
 * em shared-types):
 *  - itens são só produtos; o procedimento virou texto
 *    (`procedureDescription`) e o valor dele entra na mão de obra;
 *  - o orçamento tem uma LISTA de animais (`animalIds`).
 *
 * O formulário ainda tem um animal e itens "procedimento". Esta ponte
 * converte os procedimentos pela mesma regra da migration do banco
 * (descrição → texto, valor → mão de obra), então o total que o vet vê não
 * muda. A tela nova (vários animais, mapa, km pelo Google Maps, nome do
 * orçamento) é do João e substitui isto.
 */
export interface SplitItems {
  products: CreateAppointmentItemDto[];
  /** `undefined` quando não havia procedimento — a descrição gravada fica como está. */
  procedureDescription: string | undefined;
  procedureCents: number;
}

export function splitItems(items: AppointmentItemFormValues[]): SplitItems {
  const products: CreateAppointmentItemDto[] = [];
  const procedures: string[] = [];
  let procedureCents = 0;

  for (const item of items) {
    const quantity = parseOptionalNumber(item.quantity) ?? 1;
    const unitPriceCents = parseBRLToCents(item.unitPriceCents) ?? 0;
    if (item.kind === 'product' && item.productId) {
      products.push({ productId: item.productId, description: item.description, quantity, unitPriceCents });
    } else {
      procedures.push(quantity === 1 ? item.description : `${item.description} (x${quantity})`);
      procedureCents += Math.round(quantity * unitPriceCents);
    }
  }

  return {
    products,
    procedureDescription: procedures.length > 0 ? procedures.join('; ') : undefined,
    procedureCents,
  };
}
