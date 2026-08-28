import { PrismaClient } from '../node_modules/.prisma/client-inventory';
import { logger } from '@vetequine/shared-middlewares';

const runtimeUrl = process.env['DATABASE_URL_INVENTORY_APP'];

if (!runtimeUrl) {
  throw new Error(
    'DATABASE_URL_INVENTORY_APP ausente. O runtime precisa conectar como ' +
    'vetequine_app — o superusuário ignora Row-Level Security e o ' +
    'isolamento entre tenants ficaria furado sem erro visível.',
  );
}

/**
 * Cliente Prisma com Row-Level Security multitenancy.
 * ADR-001 §5.2 — o tenant_id NUNCA vem do cliente, só do JWT.
 */
export const prisma = new PrismaClient({
  datasourceUrl: runtimeUrl,
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('error', (e) => logger.error({ prisma: e }, 'Erro no Prisma'));

if (process.env['NODE_ENV'] !== 'production') {
  prisma.$on('query', (e) => {
    if (e.duration > 200) {
      logger.warn({ query: e.query, durationMs: e.duration }, 'Query lenta (>200ms)');
    }
  });
}

/**
 * Executa uma operação dentro do contexto RLS do tenant.
 * O PostgreSQL filtra automaticamente todas as linhas via política.
 *
 * Uso obrigatório em TODO Repository:
 *   return withTenant(ctx.tenantId, (tx) => tx.product.findMany());
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, tenantId);
    return fn(tx);
  });
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
}

/**
 * Conexão SEM RLS (mesma role superusuário do seed.ts/testes de integração,
 * não uma role nova) — uso EXCLUSIVO de jobs cross-tenant em background
 * (ex.: AlertService varrendo todos os tenants pra achar quem tem produto
 * em alerta). ADR-001 §5.2: nunca usar isto em código que atende requisição
 * HTTP — lá o isolamento por tenant é obrigatório via withTenant().
 */
export const adminPrisma = new PrismaClient({
  datasourceUrl: process.env['DATABASE_URL_INVENTORY'],
});
