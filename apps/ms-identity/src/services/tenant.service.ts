import type { ITenantService, RequestContext, RegisterTenantDto, UpdateVeterinarianDto, TenantProfile } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { hashPassword } from '../lib/password';
import type { TenantRepository } from '../repositories/tenant.repository';
import { AccountRepository } from '../repositories/account.repository';
import { AuthRepository } from '../repositories/auth.repository';
import { AccountService } from './account.service';

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa ITenantService (RF-CAD-030 / UC-CAD-04 — "Gerenciar Dados do
 * Veterinário"). Neste domínio o tenant É o veterinário assinante.
 */
export class TenantService implements ITenantService {
  constructor(
    private readonly repo: TenantRepository,
    /** Confirmação de e-mail do cadastro (M-02); só envia com EMAIL_VERIFICATION_ENABLED. */
    private readonly account: Pick<AccountService, 'sendVerificationAfterSignup'> = new AccountService(
      new AccountRepository(),
      new AuthRepository(),
    ),
  ) {}

  async register(data: RegisterTenantDto): Promise<TenantProfile> {
    const passwordHash = await hashPassword(data.password);
    const { tenantId, userId } = await this.repo.register(data, passwordHash);
    await this.account.sendVerificationAfterSignup(tenantId, userId, data.email);

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
