import type {
  IOwnerService,
  RequestContext,
  UUID,
  Paginated,
  Owner,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { OwnerRepository } from '../repositories/owner.repository';
import type { PlanService } from './plan.service';
import type { CreateOwnerInput, UpdateOwnerInput, ListOwnersInput } from '../schemas/owner.schema';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IOwnerService publicada em shared-types.
 * Dev 2 pode usar MockOwnerService com a mesma interface enquanto isto não existe.
 */
export class OwnerService implements IOwnerService {
  constructor(
    private readonly repo: OwnerRepository,
    private readonly plans: PlanService,
  ) {}

  async list(ctx: RequestContext, params: ListOwnersInput): Promise<Paginated<Owner>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Owner | null> {
    return this.repo.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreateOwnerInput): Promise<Owner> {
    // Plano Básico: limite de 30 proprietários (ERS §2.6)
    const current = await this.repo.countActive(ctx);
    await this.plans.assertOwnerLimit(ctx, current);
    return this.repo.create(ctx, data);
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateOwnerInput): Promise<Owner> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Proprietário não encontrado');
    return this.repo.update(ctx, id, data);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Proprietário não encontrado');
    await this.repo.softDelete(ctx, id);
  }
}
