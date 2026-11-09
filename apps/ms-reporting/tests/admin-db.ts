/**
 * Conexão de migração (superusuário, ignora RLS) só para limpar os testes de
 * integração. A role da aplicação não tem DELETE (auditoria M-06,
 * 01-create-app-role.sql), então a limpeza não pode passar por ela.
 */
import { PrismaClient } from '../node_modules/.prisma/client-reporting';

export const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_REPORTING'] });

export async function purgeTenants(...tenantIds: string[]): Promise<void> {
  const where = { tenantId: { in: tenantIds } };
  await admin.$transaction([admin.auditLog.deleteMany({ where }), admin.financialRecord.deleteMany({ where })]);
}
