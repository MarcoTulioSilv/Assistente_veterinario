import { randomUUID } from 'node:crypto';
import type { Product as PrismaProduct } from '../../node_modules/.prisma/client-inventory';
import type { RequestContext, UUID, Paginated, Product } from '@vetequine/shared-types';
import { withTenant, adminPrisma } from '../prisma';
import type { CreateProductInput, UpdateProductInput, ListProductsInput } from '../schemas/product.schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Camada de acesso a dados — Dev 1 é o dono.
 * Toda query passa por withTenant() → RLS ativo (ADR-001 §5.2).
 * Soft delete obrigatório: nunca DELETE físico (LGPD).
 */
export class ProductRepository {
  async list(ctx: RequestContext, params: ListProductsInput): Promise<Paginated<Product>> {
    const { page, limit, search, category } = params;
    const skip = (page - 1) * limit;

    return withTenant(ctx.tenantId, async (tx) => {
      const where = {
        deletedAt: null,
        ...(category ? { category } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.product.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
        tx.product.count({ where }),
      ]);

      return {
        data: rows.map(toDomain),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Product | null> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.product.findFirst({ where: { id, deletedAt: null } });
      return row ? toDomain(row) : null;
    });
  }

  /**
   * RF-EST-007: estoque inicial > 0 já gera um StockMovement de entrada,
   * pra rastreabilidade valer desde o primeiro momento, não só a partir
   * da primeira baixa.
   */
  async create(ctx: RequestContext, data: CreateProductInput): Promise<Product> {
    return withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          name: data.name,
          manufacturer: data.manufacturer ?? null,
          batch: data.batch ?? null,
          unit: data.unit,
          quantityInStock: data.quantityInStock ?? 0,
          dosesPerUnit: data.dosesPerUnit ?? null,
          costPriceCents: data.costPriceCents,
          markupPercent: data.markupPercent ?? 0,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
          alertDaysBefore: data.alertDaysBefore ?? 30,
          minStockQty: data.minStockQty ?? 0,
          category: data.category,
        },
      });

      if (data.quantityInStock && data.quantityInStock > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.tenantId,
            productId: row.id,
            type: 'in',
            quantity: data.quantityInStock,
            reason: 'purchase',
            idempotencyKey: randomUUID(),
            notes: 'Estoque inicial',
          },
        });
      }

      return toDomain(row);
    });
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateProductInput): Promise<Product> {
    return withTenant(ctx.tenantId, async (tx) => {
      const { expiryDate, ...rest } = data;
      const row = await tx.product.update({
        where: { id },
        data: {
          ...rest,
          ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
        },
      });
      return toDomain(row);
    });
  }

  /** Soft delete — LGPD exige exportação antes de exclusão física */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await withTenant(ctx.tenantId, (tx) =>
      tx.product.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /** Uso interno do AlertService — sem paginação, roda uma vez por tenant por dia. */
  async listAllActive(ctx: RequestContext): Promise<Product[]> {
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.product.findMany({ where: { deletedAt: null } });
      return rows.map(toDomain);
    });
  }

  /**
   * Uso interno do AlertService — não existe tabela Tenant neste banco
   * (ADR-001 §5.1), então a lista de tenants a varrer vem daqui, via
   * adminPrisma (bypassa RLS de propósito: isto não atende requisição
   * de nenhum tenant específico, precisa ver todos).
   */
  async listActiveTenantIds(): Promise<UUID[]> {
    const rows = await adminPrisma.product.findMany({
      where: { deletedAt: null },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }
}

function toDomain(row: PrismaProduct): Product {
  const quantityInStock = row.quantityInStock.toNumber();
  const minStockQty = row.minStockQty.toNumber();
  const expiryDate = row.expiryDate;

  const isNearExpiry =
    expiryDate !== null &&
    (expiryDate.getTime() - Date.now()) / MS_PER_DAY <= row.alertDaysBefore;

  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    batch: row.batch,
    unit: row.unit,
    quantityInStock,
    dosesPerUnit: row.dosesPerUnit ? row.dosesPerUnit.toNumber() : null,
    costPriceCents: row.costPriceCents,
    markupPercent: row.markupPercent.toNumber(),
    salePriceCents: row.salePriceCents ?? 0,
    expiryDate: expiryDate ? expiryDate.toISOString() : null,
    alertDaysBefore: row.alertDaysBefore,
    minStockQty,
    category: row.category,
    isNearExpiry,
    isLowStock: quantityInStock < minStockQty,
  };
}
