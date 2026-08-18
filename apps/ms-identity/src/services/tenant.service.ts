import type { ITenantService, RequestContext, RegisterTenantDto, UpdateVeterinarianDto, TenantProfile } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';
import { hashPassword } from '../lib/password';
import type { TenantRepository } from '../repositories/tenant.repository';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa ITenantService (RF-CAD-030 / UC-CAD-04 — "Gerenciar Dados do
 * Veterinário"). Neste domínio o tenant É o veterinário assinante.
 */
export class TenantService implements ITenantService {
  constructor(private readonly repo: TenantRepository) {}

  async register(data: RegisterTenantDto): Promise<TenantProfile> {
    const passwordHash = await hashPassword(data.password);
    const { tenantId } = await this.repo.register(data, passwordHash);

    const profile = await this.repo.findProfile(tenantId);
    if (!profile) throw new Error('Falha ao ler o perfil recém-criado');
    return profile;
  }

  async getMyProfile(ctx: RequestContext): Promise<TenantProfile> {
    const profile = await this.repo.findProfile(ctx.tenantId);
    if (!profile) throw AppError.notFound('Tenant não encontrado');
    return profile;
  }

  async updateVeterinarianProfile(ctx: RequestContext, data: UpdateVeterinarianDto): Promise<TenantProfile> {
    if (ctx.role !== 'admin') {
      throw AppError.forbidden('Apenas o veterinário responsável pode editar estes dados');
    }
    return this.repo.updateVeterinarian(ctx.tenantId, ctx.userId, data);
  }
}
