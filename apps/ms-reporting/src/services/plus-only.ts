import type { RequestContext } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';

/**
 * ERS §2.6 (decisão de 12/11/2026): fluxo de caixa, saídas avulsas e gráficos
 * só no Plano Plus. A rota também usa `requirePlus` (Dev 2), mas a regra mora
 * no service: vale mesmo se uma rota nova esquecer o middleware. Mesma
 * resposta do `requirePlus` (403).
 */
export function assertPlus(ctx: RequestContext): void {
  if (ctx.plan !== 'plus') throw AppError.forbidden('Recurso disponível apenas no Plano Plus');
}
