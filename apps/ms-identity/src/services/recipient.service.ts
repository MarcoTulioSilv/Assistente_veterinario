import type { IRecipientDirectory, NotificationRecipient, UUID } from '@quironequine/shared-types';
import type { RecipientRepository } from '../repositories/recipient.repository';

/**
 * Diretório de destinatários (ADR-007) — Dev 1 é o dono. O MS5 pergunta
 * quem avisar por uma rota INTERNA do MS1 (controller do Dev 2, protegida
 * por requireServiceToken; o BFF não encaminha /internal). O tenant vem do
 * evento que o MS5 está tratando, e a leitura passa por withTenant, com RLS.
 *
 * Conta desativada ou excluída não recebe aviso.
 */
export class RecipientService implements IRecipientDirectory {
  constructor(private readonly repo: RecipientRepository) {}

  byUser(tenantId: UUID, userId: UUID): Promise<NotificationRecipient | null> {
    return this.repo.byUser(tenantId, userId);
  }

  /** Os eventos do MS3 trazem o id do veterinário; o aviso vai para o usuário dele. */
  byVeterinarian(tenantId: UUID, veterinarianId: UUID): Promise<NotificationRecipient | null> {
    return this.repo.byVeterinarian(tenantId, veterinarianId);
  }

  /** Alerta de estoque é da clínica: vai para todos os administradores ativos. */
  tenantAdmins(tenantId: UUID): Promise<NotificationRecipient[]> {
    return this.repo.tenantAdmins(tenantId);
  }
}
