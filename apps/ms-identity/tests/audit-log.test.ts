/**
 * ══════════════════════════════════════════════════════════════════
 * Trilha de auditoria e DELETE revogado (auditoria 06/11/2026, M-06)
 *
 * POR QUE ESTE TESTE EXISTE: o audit_log existia mas nunca era gravado, e a
 * role da aplicação podia apagar fisicamente qualquer tabela, inclusive o
 * próprio audit_log. Aqui: cada escrita deixa um registro com QUEM, O QUÊ e
 * QUAIS CAMPOS (nunca os valores — dado pessoal não vai para uma tabela que
 * não pode ser apagada), e a role da aplicação não apaga nem altera nada
 * disso. Depende do infra/postgres-init/01-create-app-role.sql aplicado
 * depois das migrações (o CI faz isso).
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@quironequine/shared-types';
import { OwnerRepository } from '../src/repositories/owner.repository';
import { prisma as appPrisma, withTenant } from '../src/prisma';

const TENANT_ID = 'a0d10000-0000-4000-8000-000000000001';
const USER_ID = 'a0d10000-0000-4000-8000-0000000000aa';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const owners = new OwnerRepository();
const ctx: RequestContext = { tenantId: TENANT_ID, userId: USER_ID, role: 'admin', plan: 'plus', traceId: 't' };

async function cleanup(): Promise<void> {
  await admin.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.owner.deleteMany({ where: { tenantId: TENANT_ID } });
  await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
}

describe('M-06 — audit_log gravado e DELETE revogado', () => {
  beforeAll(async () => {
    await cleanup();
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Audit', slug: 'audit-log-test', plan: 'plus', status: 'active' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('criar, editar e excluir proprietário deixam um registro cada, só com os nomes dos campos', async () => {
    const created = await owners.create(ctx, { fullName: 'Maria Titular', cpf: '123.456.789-09', phone: '31999990000' });
    await owners.update(ctx, created.id, { phone: '31988887777' });
    await owners.softDelete(ctx, created.id);

    const rows = await admin.auditLog.findMany({
      where: { tenantId: TENANT_ID, recordId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => [r.action, r.tableName, r.userId])).toEqual([
      ['create', 'owners', USER_ID],
      ['update', 'owners', USER_ID],
      ['delete', 'owners', USER_ID],
    ]);
    expect(rows[0]!.newValues).toEqual({ fields: ['cpf', 'fullName', 'phone'] });
    expect(rows[1]!.newValues).toEqual({ fields: ['phone'] });

    // Nenhum valor pessoal foi copiado para a trilha.
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('Maria');
    expect(dump).not.toContain('123.456.789-09');
    expect(dump).not.toContain('3198888');
  });

  it('a escrita desfeita leva o registro de auditoria junto (mesma transação)', async () => {
    const before = await admin.auditLog.count({ where: { tenantId: TENANT_ID } });
    // CPF repetido no mesmo tenant: a UNIQUE recusa e a transação inteira volta.
    await expect(owners.create(ctx, { fullName: 'Outra', cpf: '123.456.789-09' })).rejects.toThrow();
    expect(await admin.auditLog.count({ where: { tenantId: TENANT_ID } })).toBe(before);
  });

  it('a role da aplicação não apaga nem altera o audit_log', async () => {
    await expect(
      withTenant(TENANT_ID, (tx) => tx.auditLog.deleteMany({ where: { tenantId: TENANT_ID } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(TENANT_ID, (tx) => tx.auditLog.updateMany({ where: { tenantId: TENANT_ID }, data: { action: 'x' } })),
    ).rejects.toThrow(/permission denied/);
  });

  it('a role da aplicação não apaga fisicamente um proprietário (só soft delete)', async () => {
    const created = await owners.create(ctx, { fullName: 'Fica' });
    await expect(withTenant(TENANT_ID, (tx) => tx.owner.delete({ where: { id: created.id } }))).rejects.toThrow(
      /permission denied/,
    );
    expect(await admin.owner.count({ where: { id: created.id } })).toBe(1);
  });
});
