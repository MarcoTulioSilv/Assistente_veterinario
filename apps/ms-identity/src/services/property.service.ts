import type { IPropertyService, RequestContext, UUID, Paginated, Property } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';
import type { PropertyRepository } from '../repositories/property.repository';
import type { GeoService } from './geo.service';
import type { PlanService } from './plan.service';
import type { CreatePropertyInput, UpdatePropertyInput, ListPropertiesInput } from '../schemas/property.schema';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IPropertyService publicada em shared-types.
 */
export class PropertyService implements IPropertyService {
  constructor(
    private readonly repo: PropertyRepository,
    private readonly geo: GeoService,
    private readonly plans: PlanService,
  ) {}

  async list(ctx: RequestContext, params: ListPropertiesInput): Promise<Paginated<Property>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Property | null> {
    return this.repo.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreatePropertyInput): Promise<Property> {
    // ERS §2.6: Plano Básico limita propriedades a 30 (mesma cota do Owner).
    const current = await this.repo.countActive(ctx);
    await this.plans.assertPropertyLimit(ctx, current);

    const coordinates = await this.geo.resolveCoordinates(data);
    return this.repo.create(ctx, data, coordinates);
  }

  async update(ctx: RequestContext, id: UUID, data: UpdatePropertyInput): Promise<Property> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Propriedade não encontrada');

    const coordinates = await this.geo.resolveCoordinates(data);
    return this.repo.update(ctx, id, data, coordinates);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Propriedade não encontrada');
    await this.repo.softDelete(ctx, id);
  }
}
