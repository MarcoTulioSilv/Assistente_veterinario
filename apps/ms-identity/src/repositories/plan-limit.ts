/**
 * Limite de plano sem corrida (auditoria 06/11/2026, B-01).
 *
 * Antes, o service contava os cadastros e depois criava, em transações
 * separadas: dois cadastros ao mesmo tempo viam 29 e passavam os dois, e a
 * clínica do Plano Básico ficava com 31. Agora a contagem e a gravação
 * acontecem na MESMA transação, depois de uma trava por (clínica, recurso):
 * o segundo cadastro espera o primeiro terminar e já conta o novo.
 *
 * A regra (quanto é o limite, qual mensagem) continua no PlanService; o
 * repositório só executa a checagem que o service passa, no momento certo.
 */

/** Checagem do limite, com a quantidade de cadastros ativos já sob a trava. */
export type LimitGuard = (activeCount: number) => Promise<void> | void;

/** O mínimo de uma transação do Prisma que a trava usa. */
interface LockTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/**
 * Trava da transação (some no commit ou no rollback) por clínica e recurso.
 * Cadastros de clínicas diferentes, ou de recursos diferentes, não se esperam.
 */
export async function lockPlanLimit(tx: LockTx, tenantId: string, resource: 'owners' | 'properties'): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${resource}`}))`;
}
