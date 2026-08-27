import type { RequestContext } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';

/**
 * Limites por plano — ERS §2.6.
 * Animal NÃO tem limite em nenhum plano (confirmado com o time — a
 * frase ambígua da ERS "até 30 proprietários / animais e propriedades
 * ilimitados" tinha sugerido o contrário, mas a regra real é: só
 * Owner e Property são limitados no Básico).
 */
const LIMITS = {
  basic: { maxOwners: 30, maxProperties: 30, maxUsers: 1 },
  plus: { maxOwners: Infinity, maxProperties: Infinity, maxUsers: 3 },
} as const;

export class PlanService {
  async assertOwnerLimit(ctx: RequestContext, currentCount: number): Promise<void> {
    const limit = LIMITS[ctx.plan].maxOwners;
    if (currentCount >= limit) {
      throw AppError.planLimit(
        `Plano Básico permite até ${limit} proprietários. Faça upgrade para o Plano Plus.`,
      );
    }
  }

  async assertPropertyLimit(ctx: RequestContext, currentCount: number): Promise<void> {
    const limit = LIMITS[ctx.plan].maxProperties;
    if (currentCount >= limit) {
      throw AppError.planLimit(
        `Plano Básico permite até ${limit} propriedades. Faça upgrade para o Plano Plus.`,
      );
    }
  }

  async assertUserLimit(ctx: RequestContext, currentCount: number): Promise<void> {
    const limit = LIMITS[ctx.plan].maxUsers;
    if (currentCount >= limit) {
      throw AppError.planLimit(`Seu plano permite até ${limit} usuário(s).`);
    }
  }

  isPlus(ctx: RequestContext): boolean {
    return ctx.plan === 'plus';
  }
}
