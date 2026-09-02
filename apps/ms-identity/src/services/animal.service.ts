import type { IAnimalService, RequestContext, UUID, Paginated, Animal } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';
import type { AnimalRepository } from '../repositories/animal.repository';
import type { CreateAnimalInput, UpdateAnimalInput, ListAnimalsInput } from '../schemas/animal.schema';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IAnimalService publicada em shared-types.
 * Sem PlanService injetado: Animal não tem limite de plano em nenhum
 * plano (confirmado com o time — diferente de Owner/Property).
 */
export class AnimalService implements IAnimalService {
  constructor(private readonly repo: AnimalRepository) {}

  async list(ctx: RequestContext, params: ListAnimalsInput): Promise<Paginated<Animal>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Animal | null> {
    return this.repo.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreateAnimalInput): Promise<Animal> {
    return this.repo.create(ctx, data);
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateAnimalInput): Promise<Animal> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Animal não encontrado');
    return this.repo.update(ctx, id, data);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Animal não encontrado');
    await this.repo.softDelete(ctx, id);
  }

  /** RN-010: preserva histórico integralmente */
  async transfer(ctx: RequestContext, id: UUID, toPropertyId: UUID, notes?: string): Promise<Animal> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Animal não encontrado');
    return this.repo.transfer(ctx, id, toPropertyId, notes);
  }
}
