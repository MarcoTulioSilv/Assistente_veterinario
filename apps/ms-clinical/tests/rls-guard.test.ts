/**
 * Guarda do isolamento entre tenants do MS3 (ADR-001 §5.2) — revisão de
 * segurança da Sprint 8.
 *
 * Os testes de cada repositório provam que a LEITURA de um tenant não vê o
 * outro. Este arquivo cobre o que eles não cobrem:
 *  - toda tabela tem RLS e política — inclusive as que ainda vão ser
 *    criadas: migration nova sem política quebra este teste, não a produção;
 *  - a conexão do runtime não tem como contornar o RLS;
 *  - a ESCRITA também é isolada (gravar com o tenant_id de outro falha);
 *  - sem tenant no contexto, nada aparece (falha fechada).
 *
 * Roda com a conexão do runtime (quironequine_app), como em produção.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenant } from '../src/prisma';

const TENANT_A = 'c1000000-0000-0000-0000-000000000000';
const TENANT_B = 'c2000000-0000-0000-0000-000000000000';

/** Controle interno do Prisma — não guarda dado de tenant. */
const OUTSIDE_RLS = ['_prisma_migrations'];

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await withTenant(tenantId, (tx) => tx.examType.deleteMany({}));
  }
  await prisma.$disconnect();
});

describe('cobertura do RLS', () => {
  it('toda tabela do schema public tem RLS ligado e ao menos uma política', async () => {
    const tables = await prisma.$queryRaw<Array<{ table: string; rls: boolean; policies: number }>>`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const unprotected = tables
      .filter((t) => !OUTSIDE_RLS.includes(t.table))
      .filter((t) => !t.rls || t.policies === 0)
      .map((t) => t.table);

    expect(tables.length).toBeGreaterThan(OUTSIDE_RLS.length);
    expect(unprotected).toEqual([]);
  });

  it('a conexão do runtime não é superusuário, não ignora RLS e não é dona de tabela', async () => {
    const [role] = await prisma.$queryRaw<Array<{ name: string; superuser: boolean; bypassrls: boolean; owns: number }>>`
      SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
             (SELECT count(*)::int FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owns
      FROM pg_roles r WHERE r.rolname = current_user
    `;
    // Dono da tabela também passa por cima do RLS (sem FORCE) — por isso
    // as migrations rodam com outro usuário.
    expect(role).toEqual({ name: 'quironequine_app', superuser: false, bypassrls: false, owns: 0 });
  });

  it('a aplicação não alcança o histórico de migrations', async () => {
    const [privs] = await prisma.$queryRaw<Array<{ select: boolean; insert: boolean; delete: boolean }>>`
      SELECT has_table_privilege('_prisma_migrations', 'SELECT') AS select,
             has_table_privilege('_prisma_migrations', 'INSERT') AS insert,
             has_table_privilege('_prisma_migrations', 'DELETE') AS delete
    `;
    expect(privs).toEqual({ select: false, insert: false, delete: false });
  });
});

describe('isolamento de escrita e falha fechada', () => {
  it('gravar com o tenant_id de OUTRO tenant é recusado pelo banco', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.examType.create({ data: { tenantId: TENANT_B, name: 'Invasor', protocolFields: [] } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('mover uma linha para outro tenant também é recusado', async () => {
    const created = await withTenant(TENANT_A, (tx) =>
      tx.examType.create({ data: { tenantId: TENANT_A, name: 'Mormo', protocolFields: [] } }),
    );

    await expect(
      withTenant(TENANT_A, (tx) => tx.examType.update({ where: { id: created.id }, data: { tenantId: TENANT_B } })),
    ).rejects.toThrow(/row-level security/i);
  });

  it('sem tenant no contexto, nenhuma linha aparece — nem de A nem de B', async () => {
    await withTenant(TENANT_B, (tx) =>
      tx.examType.create({ data: { tenantId: TENANT_B, name: `AIE ${randomUUID()}`, protocolFields: [] } }),
    );

    // Transação SEM set_config: é o que aconteceria se um repositório
    // esquecesse o withTenant().
    const visible = await prisma.$transaction((tx) => tx.examType.count());

    expect(visible).toBe(0);
  });
});
