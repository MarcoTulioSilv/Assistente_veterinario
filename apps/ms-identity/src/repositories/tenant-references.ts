import type { Prisma } from '@prisma/client';
import { AppError } from '@quironequine/shared-middlewares';

/**
 * Confere, dentro da transação do withTenant, que os IDs que o cliente
 * mandou existem NESTE tenant (auditoria M-01).
 *
 * O banco já recusa a ligação entre tenants pelas FKs compostas
 * (migração fk_composta_tenant), mas a recusa vira um erro de FK (500). Aqui
 * o RLS esconde as linhas dos outros tenants, então "é de outro tenant" e
 * "não existe" dão a mesma resposta: 404, sem oráculo. Registro excluído
 * (soft delete) também não serve de referência nova.
 */
export async function assertTenantReferences(
  tx: Prisma.TransactionClient,
  refs: {
    propertyIds?: ReadonlyArray<string | null | undefined>;
    ownerIds?: ReadonlyArray<string | null | undefined>;
  },
): Promise<void> {
  const propertyIds = distinct(refs.propertyIds);
  if (propertyIds.length > 0) {
    const found = await tx.property.count({ where: { id: { in: propertyIds }, deletedAt: null } });
    if (found !== propertyIds.length) throw AppError.notFound('Propriedade não encontrada');
  }

  const ownerIds = distinct(refs.ownerIds);
  if (ownerIds.length > 0) {
    const found = await tx.owner.count({ where: { id: { in: ownerIds }, deletedAt: null } });
    if (found !== ownerIds.length) throw AppError.notFound('Proprietário não encontrado');
  }
}

function distinct(ids: ReadonlyArray<string | null | undefined> | undefined): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => typeof id === 'string'))];
}
