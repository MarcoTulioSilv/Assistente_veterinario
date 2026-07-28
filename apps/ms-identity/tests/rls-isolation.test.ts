/**
 * ══════════════════════════════════════════════════════════════════
 * Teste de isolamento multitenancy (Row-Level Security)
 *
 * POR QUE ESTE TESTE EXISTE:
 * O RLS e a unica barreira que impede o veterinario A de ver os dados
 * do veterinario B. Se uma tabela nova for criada sem policy, ou se a
 * conexao usar superusuario por engano, o vazamento e silencioso --
 * nenhum erro, nenhum log. So um teste pega isso.
 *
 * Refs: RNF-SEG-004 / ADR-001 5.2 / Contrato Clausula 10a
 * ══════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/** Conexao de migration: superusuario, ignora RLS. Usada so no setup. */
const admin = new PrismaClient({
  datasourceUrl: process.env['DATABASE_URL_IDENTITY'],
});

/** Conexao de runtime: role restrita, RLS ativo. E o que testamos. */
const app = new PrismaClient({
  datasourceUrl: process.env['DATABASE_URL_IDENTITY_APP'],
});

/** Executa uma query no contexto de um tenant, como o withTenant() faz */
async function asTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof app.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, tenantId);
    return fn(tx);
  });
}

/** Executa sem definir tenant algum */
async function withoutTenant<T>(
  fn: (tx: Parameters<Parameters<typeof app.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '', true)`);
    return fn(tx);
  });
}

describe('Row-Level Security — isolamento entre tenants', () => {
  beforeAll(async () => {
    await cleanup();

    await admin.tenant.createMany({
      data: [
        { id: TENANT_A, name: 'Clinica A', slug: 'rls-test-a', plan: 'plus', status: 'active' },
        { id: TENANT_B, name: 'Clinica B', slug: 'rls-test-b', plan: 'basic', status: 'active' },
      ],
    });

    await admin.owner.createMany({
      data: [
        { tenantId: TENANT_A, fullName: 'Proprietario da Clinica A', status: 'active' },
        { tenantId: TENANT_A, fullName: 'Segundo da Clinica A', status: 'active' },
        { tenantId: TENANT_B, fullName: 'Proprietario da Clinica B', status: 'active' },
      ],
    });

    await admin.property.createMany({
      data: [
        { tenantId: TENANT_A, name: 'Fazenda A', status: 'active' },
        { tenantId: TENANT_B, name: 'Fazenda B', status: 'active' },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
    await app.$disconnect();
  });

  // ─── Pre-condicao: a conexao de runtime NAO pode ser superusuaria ──
  it('a conexao de runtime nao ignora RLS', async () => {
    const rows = await app.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  // ─── Isolamento em cada tabela ────────────────────────────────────
  it('tenant A ve apenas os proprios proprietarios', async () => {
    const owners = await asTenant(TENANT_A, (tx) => tx.owner.findMany());
    expect(owners).toHaveLength(2);
    expect(owners.every((o) => o.tenantId === TENANT_A)).toBe(true);
  });

  it('tenant B ve apenas os proprios proprietarios', async () => {
    const owners = await asTenant(TENANT_B, (tx) => tx.owner.findMany());
    expect(owners).toHaveLength(1);
    expect(owners[0]?.fullName).toBe('Proprietario da Clinica B');
  });

  it('tenant A ve apenas as proprias propriedades', async () => {
    const props = await asTenant(TENANT_A, (tx) => tx.property.findMany());
    expect(props).toHaveLength(1);
    expect(props[0]?.name).toBe('Fazenda A');
  });

  // ─── Sem contexto: nao ve nada ────────────────────────────────────
  it('sem tenant definido, nenhuma linha e retornada', async () => {
    const owners = await withoutTenant((tx) => tx.owner.findMany());
    expect(owners).toHaveLength(0);
  });

  // ─── Escrita tambem e isolada ─────────────────────────────────────
  it('tenant A nao consegue ler registro criado pelo tenant B', async () => {
    const created = await asTenant(TENANT_B, (tx) =>
      tx.owner.create({
        data: { tenantId: TENANT_B, fullName: 'Criado no contexto B', status: 'active' },
      }),
    );

    const found = await asTenant(TENANT_A, (tx) =>
      tx.owner.findFirst({ where: { id: created.id } }),
    );

    expect(found).toBeNull();
  });

  // ─── Cobertura: toda tabela com tenant_id precisa de policy ───────
  it('todas as tabelas com tenant_id tem policy de RLS', async () => {
    const gaps = await admin.$queryRaw<Array<{ tablename: string }>>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'tenant_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname)
    `;

    // Se falhar aqui, alguem criou tabela com tenant_id e esqueceu a policy
    expect(gaps.map((g) => g.tablename)).toEqual([]);
  });

  it('RLS esta habilitado em todas as tabelas com policy', async () => {
    const disabled = await admin.$queryRaw<Array<{ tablename: string }>>`
      SELECT DISTINCT p.tablename
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      WHERE p.schemaname = 'public' AND c.relrowsecurity = false
    `;

    // Policy existir nao basta -- a tabela precisa ter RLS ligado
    expect(disabled.map((d) => d.tablename)).toEqual([]);
  });
});

async function cleanup(): Promise<void> {
  await admin.owner.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  await admin.property.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  await admin.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
}
