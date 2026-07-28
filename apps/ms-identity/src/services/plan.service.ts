import type { RequestContext } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';

/** Limites por plano — ERS §2.6 */
const LIMITS = {
  basic: { maxOwners: 30, maxUsers: 1 },
  plus: { maxOwners: Infinity, maxUsers: 3 },
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
