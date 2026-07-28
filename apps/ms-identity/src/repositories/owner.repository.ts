import type { Owner as PrismaOwner } from '@prisma/client';
import type { RequestContext, UUID, Paginated, Owner } from '@vetequine/shared-types';
import { withTenant } from '../prisma';
import type { CreateOwnerInput, UpdateOwnerInput, ListOwnersInput } from '../schemas/owner.schema';

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class OwnerRepository {
  async list(ctx: RequestContext, params: ListOwnersInput): Promise<Paginated<Owner>> {
    const { page, limit, search, status } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = {
        deletedAt: null,
        ...(status !== 'all' ? { status } : {}),
        ...(search ? { fullName: { contains: search, mode: 'insensitive' as const } } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.owner.findMany({ where, skip, take: limit, orderBy: { fullName: 'asc' } }),
        tx.owner.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Owner | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.owner.findFirst({ where: { id, deletedAt: null } });
      return row ? toDomain(row) : null;
    });
  }

  async countActive(ctx: RequestContext): Promise<number> {
    return withTenant(ctx.tenantId, (tx) => tx.owner.count({ where: { deletedAt: null } }));
  }

  async create(ctx: RequestContext, data: CreateOwnerInput): Promise<Owner> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.owner.create({
        data: {
          tenantId: ctx.tenantId,
          fullName: data.fullName,
          cpf: data.cpf ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          phone2: data.phone2 ?? null,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          // RN-006: cadastro parcial fica 'pending'
          status: data.cpf && data.phone ? 'active' : 'pending',
        },
      });
      return toDomain(row);
    });
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateOwnerInput): Promise<Owner> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.owner.update({ where: { id }, data });
      return toDomain(row);
    });
  }

  /** Soft delete — LGPD exige exportação antes de exclusão física */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.owner.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}

function toDomain(row: PrismaOwner): Owner {
  return {
    id: row.id,
    fullName: row.fullName,
    cpf: row.cpf,
    email: row.email,
    phone: row.phone ?? '',
    phone2: row.phone2,
    address: row.address,
    city: row.city ?? '',
    state: row.state ?? '',
    status: row.status,
    notifyBlocked: row.notifyBlocked,
    createdAt: row.createdAt.toISOString(),
  };
}
