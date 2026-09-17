import type { UserRole, TenantPlan } from '@quironequine/shared-types';
import { prisma, withTenant } from '../prisma';

export interface AuthLookupRow {
  id: string;
  tenantId: string;
  passwordHash: string;
  role: UserRole;
  fullName: string;
  totpSecret: string | null;
  totpEnabled: boolean;
  userStatus: 'active' | 'inactive';
  tenantPlan: TenantPlan;
  tenantStatus: 'active' | 'suspended' | 'cancelled';
}

export interface AuthUserRow {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  fullName: string;
  status: 'active' | 'inactive';
  refreshTokenHash: string | null;
  refreshTokenExpiresAt: Date | null;
  tenantPlan: TenantPlan;
  tenantStatus: 'active' | 'suspended' | 'cancelled';
}

interface RawLookupRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  role: UserRole;
  full_name: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  user_status: 'active' | 'inactive';
  tenant_plan: TenantPlan;
  tenant_status: 'active' | 'suspended' | 'cancelled';
}

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 *
 * findAuthByEmail() e findTenantIdForUser() são a ÚNICA exceção a
 * "toda leitura de users passa por withTenant()" no código-base — ver
 * ADR-004. Chamam funções SECURITY DEFINER, nunca SELECT direto em
 * users; a partir do momento em que o tenantId é conhecido, todo o
 * resto volta ao caminho normal via withTenant().
 */
export class AuthRepository {
  async findAuthByEmail(email: string): Promise<AuthLookupRow | null> {
    const rows = await prisma.$queryRaw<RawLookupRow[]>`
      SELECT * FROM auth_lookup_by_email(${email})
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      passwordHash: row.password_hash,
      role: row.role,
      fullName: row.full_name,
      totpSecret: row.totp_secret,
      totpEnabled: row.totp_enabled,
      userStatus: row.user_status,
      tenantPlan: row.tenant_plan,
      tenantStatus: row.tenant_status,
    };
  }

  async findTenantIdForUser(userId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ auth_tenant_id_for_user: string | null }>>`
      SELECT auth_tenant_id_for_user(${userId}::uuid)
    `;
    return rows[0]?.auth_tenant_id_for_user ?? null;
  }

  async findById(tenantId: string, userId: string): Promise<AuthUserRow | null> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { tenant: true },
      });
      if (!row) return null;

      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        role: row.role,
        fullName: row.fullName,
        status: row.status,
        refreshTokenHash: row.refreshTokenHash,
        refreshTokenExpiresAt: row.refreshTokenExpiresAt,
        tenantPlan: row.tenant.plan,
        tenantStatus: row.tenant.status,
      };
    });
  }

  async recordSuccessfulLogin(
    tenantId: string,
    userId: string,
    refreshTokenHash: string,
    refreshTokenExpiresAt: Date,
  ): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date(), refreshTokenHash, refreshTokenExpiresAt },
      }),
    );
  }

  async rotateRefreshToken(
    tenantId: string,
    userId: string,
    refreshTokenHash: string,
    refreshTokenExpiresAt: Date,
  ): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { refreshTokenHash, refreshTokenExpiresAt },
      }),
    );
  }

  async clearRefreshToken(tenantId: string, userId: string): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      }),
    );
  }
}
