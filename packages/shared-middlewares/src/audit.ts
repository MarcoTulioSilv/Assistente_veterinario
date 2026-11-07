/**
 * Trilha de auditoria (auditoria 06/11/2026, M-06; LGPD art. 37).
 *
 * Responde "quem fez o quê, em qual registro e quando". Grava na tabela
 * `audit_log` do banco do próprio serviço, NA MESMA TRANSAÇÃO do
 * withTenant: se a escrita for desfeita, o registro de auditoria também é,
 * e o RLS garante que a linha é do tenant da sessão.
 *
 * Guarda só os NOMES dos campos alterados, nunca os valores. O audit_log é
 * só de inserção (a role da aplicação não tem UPDATE nem DELETE nele):
 * copiar nome, CPF ou anamnese para ele criaria dado pessoal que nunca
 * poderia ser apagado a pedido do titular.
 */

/**
 * O mínimo do Prisma client (ou de uma transação dele) que o helper usa.
 * Estrutural para servir aos clients gerados de todos os serviços.
 */
export interface AuditTx {
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'read'
  | 'transfer'
  | 'finish'
  | 'advance'
  | 'receive'
  | 'cancel';

export interface AuditEntry {
  action: AuditAction;
  /** Nome da tabela do registro (ex.: 'owners', 'appointments'). */
  table: string;
  recordId: string;
  /** Campos enviados/alterados — só os nomes. */
  fields?: readonly string[];
  /**
   * Origem quando não há usuário: 'event:appointment.finished',
   * 'job:reminders'. Com usuário, fica vazio.
   */
  source?: string;
}

export interface AuditActor {
  tenantId: string;
  /** null em escrita feita pelo sistema (consumidor de evento, job). */
  userId: string | null;
}

export async function writeAudit(tx: AuditTx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const details: Record<string, unknown> = {};
  if (entry.fields && entry.fields.length > 0)
    details['fields'] = [...new Set(entry.fields)].sort();
  if (entry.source) details['source'] = entry.source;

  await tx.$executeRawUnsafe(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, table_name, record_id, new_values)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb)`,
    actor.tenantId,
    actor.userId,
    entry.action,
    entry.table,
    entry.recordId,
    Object.keys(details).length > 0 ? JSON.stringify(details) : null,
  );
}

/**
 * Nomes dos campos presentes num objeto de entrada (PATCH), ignorando os
 * `undefined` — o que o cliente de fato mandou alterar.
 */
export function changedFields(data: object): string[] {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
}
