import type { Animal as PrismaAnimal } from '@prisma/client';
import type { RequestContext, UUID, Paginated, Animal } from '@quironequine/shared-types';
import { withTenant } from '../prisma';
import type { CreateAnimalInput, UpdateAnimalInput, ListAnimalsInput } from '../schemas/animal.schema';

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class AnimalRepository {
  async list(ctx: RequestContext, params: ListAnimalsInput): Promise<Paginated<Animal>> {
    const { page, limit, search, status, propertyId } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = {
        deletedAt: null,
        ...(status !== 'all' ? { status } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(propertyId ? { propertyId } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.animal.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
        tx.animal.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Animal | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.animal.findFirst({ where: { id, deletedAt: null } });
      return row ? toDomain(row) : null;
    });
  }

  async countActive(ctx: RequestContext): Promise<number> {
    return withTenant(ctx.tenantId, (tx) => tx.animal.count({ where: { deletedAt: null } }));
  }

  async create(ctx: RequestContext, data: CreateAnimalInput): Promise<Animal> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.animal.create({
        data: {
          tenantId: ctx.tenantId,
          name: data.name,
          species: data.species ?? undefined, // deixa o default "equine" do Prisma valer
          sex: data.sex ?? null,
          breed: data.breed ?? null,
          coat: data.coat ?? null,
          birthDate: data.birthDate ? new Date(data.birthDate) : null,
          castrated: data.castrated ?? false,
          photoUrl: data.photoUrl ?? null,
          sketchUrl: data.sketchUrl ?? null,
          propertyId: data.propertyId ?? null,
          ownerId: data.ownerId ?? null,
          // RF-CAD-025: cadastro parcial (nome + dados descritivos) fica 'pending'
          // até ter propriedade E proprietário atribuídos.
          status: data.propertyId && data.ownerId ? 'active' : 'pending',
        },
      });
      return toDomain(row);
    });
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateAnimalInput): Promise<Animal> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { birthDate, ...rest } = data;
      const row = await tx.animal.update({
        where: { id },
        data: { ...rest, ...(birthDate !== undefined ? { birthDate: new Date(birthDate) } : {}) },
      });
      return toDomain(row);
    });
  }

  /** Soft delete — LGPD exige exportação antes de exclusão física */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.animal.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /**
   * RN-010: transferência entre propriedades preserva histórico
   * integralmente. O histórico clínico não é vinculado à Property no
   * schema (M2/Clinical nem existe ainda), então isso já vale sozinho —
   * o que fazemos aqui é registrar a transferência em si como um log
   * imutável (animal_transfers nunca tem UPDATE/DELETE, só INSERT).
   * fromPropertyId fica null quando é a primeira atribuição do animal
   * a uma propriedade (não uma transferência de fato).
   */
  async transfer(ctx: RequestContext, id: UUID, toPropertyId: UUID, notes?: string): Promise<Animal> {
    return withTenant(ctx.tenantId, async (tx) => {
      const current = await tx.animal.findFirstOrThrow({ where: { id, deletedAt: null } });

      await tx.animalTransfer.create({
        data: {
          tenantId: ctx.tenantId,
          animalId: id,
          fromPropertyId: current.propertyId,
          toPropertyId,
          notes: notes ?? null,
        },
      });

      const row = await tx.animal.update({ where: { id }, data: { propertyId: toPropertyId } });
      return toDomain(row);
    });
  }
}

function toDomain(row: PrismaAnimal): Animal {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    sex: row.sex,
    breed: row.breed,
    coat: row.coat,
    birthDate: row.birthDate ? row.birthDate.toISOString() : null,
    castrated: row.castrated,
    photoUrl: row.photoUrl,
    sketchUrl: row.sketchUrl,
    status: row.status,
    propertyId: row.propertyId,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  };
}
