import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TenantProfile } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import { prisma, withTenant } from '../prisma';
import type { RegisterTenantInput, UpdateVeterinarianInput } from '../schemas/tenant.schema';

interface RegisterResult {
  tenantId: string;
  userId: string;
  veterinarianId: string;
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 *
 * register() é a única exceção a "toda escrita passa por withTenant()" com
 * tenantId conhecido de antemão — aqui o tenantId só existe a partir da
 * criação do próprio Tenant (que não tem RLS). Não é um bypass novo: dentro
 * da mesma transação, definimos app.current_tenant assim que o Tenant é
 * criado, então User/Veterinarian passam pelo RLS normalmente. Ver plano
 * TenantService / Decisão 2.
 */
export class TenantRepository {
  async register(data: RegisterTenantInput, passwordHash: string): Promise<RegisterResult> {
    const slug = await this.generateUniqueSlug(data.tenantName ?? data.fullName);

    try {
      return await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: data.tenantName ?? data.fullName, slug, plan: 'basic', status: 'active' },
        });

        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, tenant.id);

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: data.email,
            passwordHash,
            role: 'admin',
            fullName: data.fullName,
            phone: data.phone,
            status: 'active',
          },
        });

        const veterinarian = await tx.veterinarian.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            fullName: data.fullName,
            crmv: data.crmv,
            crmvState: data.crmvState,
            cpfCnpj: data.cpfCnpj,
            phone: data.phone,
            email: data.email,
            // TODO(Dev2/João): logoUrl só aceita URL já hospedada — falta
            // integrar upload real (adapter S3/R2) antes de expor isso na
            // tela de cadastro. Ver ITenantService em shared-types.
            logoUrl: data.logoUrl ?? null,
          },
        });

        return { tenantId: tenant.id, userId: user.id, veterinarianId: veterinarian.id };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('E-mail já cadastrado');
      }
      throw e;
    }
  }

  async findProfile(tenantId: string): Promise<TenantProfile | null> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) return null;

    return withTenant(tenantId, async (tx) => {
      const veterinarian = await tx.veterinarian.findFirst({ where: { tenantId } });
      if (!veterinarian) return null;

      return toProfile(tenant, veterinarian);
    });
  }

  async updateVeterinarian(
    tenantId: string,
    userId: string,
    data: UpdateVeterinarianInput,
  ): Promise<TenantProfile> {
    return withTenant(tenantId, async (tx) => {
      const veterinarian = await tx.veterinarian.update({
        where: { userId },
        data: {
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          logoUrl: data.logoUrl,
        },
      });

      // Mantém User em sincronia — seed.ts já trata os dois como devendo bater.
      if (data.fullName || data.phone || data.email) {
        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: data.fullName,
            phone: data.phone,
            email: data.email,
          },
        });
      }

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      return toProfile(tenant, veterinarian);
    });
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const exists = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw new Error('Não foi possível gerar slug único para o tenant');
  }
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos (apos normalize('NFD'), \p{Diacritic} evita ambiguidade de encoding)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

interface TenantRow {
  id: string;
  name: string;
  plan: 'basic' | 'plus';
  status: 'active' | 'suspended' | 'cancelled';
}

interface VeterinarianRow {
  id: string;
  userId: string;
  fullName: string;
  crmv: string;
  crmvState: string;
  cpfCnpj: string;
  phone: string;
  email: string;
  logoUrl: string | null;
}

function toProfile(tenant: TenantRow, veterinarian: VeterinarianRow): TenantProfile {
  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    plan: tenant.plan,
    status: tenant.status,
    veterinarian: {
      id: veterinarian.id,
      userId: veterinarian.userId,
      fullName: veterinarian.fullName,
      crmv: veterinarian.crmv,
      crmvState: veterinarian.crmvState,
      cpfCnpj: veterinarian.cpfCnpj,
      phone: veterinarian.phone,
      email: veterinarian.email,
      logoUrl: veterinarian.logoUrl,
    },
  };
}
