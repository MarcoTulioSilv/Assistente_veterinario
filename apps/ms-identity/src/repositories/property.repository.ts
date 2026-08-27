import type { Property as PrismaProperty } from '@prisma/client';
import type { RequestContext, UUID, Paginated, Property } from '@vetequine/shared-types';
import { withTenant } from '../prisma';
import type { CreatePropertyInput, UpdatePropertyInput, ListPropertiesInput } from '../schemas/property.schema';

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class PropertyRepository {
  async list(ctx: RequestContext, params: ListPropertiesInput): Promise<Paginated<Property>> {
    const { page, limit, search, status, ownerId } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = {
        deletedAt: null,
        ...(status !== 'all' ? { status } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(ownerId ? { owners: { some: { ownerId } } } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.property.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
        tx.property.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Property | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.property.findFirst({ where: { id, deletedAt: null } });
      return row ? toDomain(row) : null;
    });
  }

  async countActive(ctx: RequestContext): Promise<number> {
    return withTenant(ctx.tenantId, (tx) => tx.property.count({ where: { deletedAt: null } }));
  }

  async create(
    ctx: RequestContext,
    data: CreatePropertyInput,
    coordinates: { latitude: number; longitude: number } | null,
  ): Promise<Property> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.property.create({
        data: {
          tenantId: ctx.tenantId,
          name: data.name,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          zipCode: data.zipCode ?? null,
          latitude: coordinates?.latitude ?? null,
          longitude: coordinates?.longitude ?? null,
          // RN-006: cadastro parcial fica 'pending'
          status: data.address && data.city && data.state ? 'active' : 'pending',
        },
      });

      if (data.ownerIds && data.ownerIds.length > 0) {
        await tx.propertyOwner.createMany({
          data: data.ownerIds.map((ownerId, index) => ({
            tenantId: ctx.tenantId,
            propertyId: row.id,
            ownerId,
            isPrimary: index === 0,
          })),
        });
      }

      return toDomain(row);
    });
  }

  async update(
    ctx: RequestContext,
    id: UUID,
    data: UpdatePropertyInput,
    coordinates: { latitude: number; longitude: number } | null,
  ): Promise<Property> {
    return withTenant(ctx.tenantId, async (tx) => {
      // ownerIds não é coluna do Prisma — extrai antes de passar `rest` pro
      // update, senão quebra em runtime (mesmo problema que existia em
      // owner.repository.ts com propertyIds). Reassociar donos via PATCH
      // não está no escopo desta versão, só na criação.
      const { ownerIds: _ownerIds, ...rest } = data;
      const row = await tx.property.update({
        where: { id },
        data: {
          ...rest,
          ...(coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
        },
      });
      return toDomain(row);
    });
  }

  /** Soft delete — LGPD exige exportação antes de exclusão física */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.property.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}

function toDomain(row: PrismaProperty): Property {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city ?? '',
    state: row.state ?? '',
    zipCode: row.zipCode,
    latitude: row.latitude ? row.latitude.toNumber() : null,
    longitude: row.longitude ? row.longitude.toNumber() : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
