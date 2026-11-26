import type { IRecipientDirectory, NotificationRecipient, UUID } from '@quironequine/shared-types';
import { SERVICE_TOKEN_HEADER } from '@quironequine/shared-middlewares';

/** Resposta da rota interna fora do esperado — o job falha e o BullMQ tenta de novo. */
export class DirectoryUnavailableError extends Error {
  constructor(status: number | 'timeout' | 'network') {
    super(`Diretório do MS1 indisponível (${status})`);
    this.name = 'DirectoryUnavailableError';
  }
}

type Fetch = typeof fetch;

/**
 * Cliente do diretório de destinatários do MS1 (ADR-007): rotas INTERNAS
 * (`/internal/...`, que o BFF não encaminha), autenticadas pelo token de
 * serviço. O MS5 pergunta quem avisar; o MS1 responde só usuários ativos.
 *
 * 404 = não há destinatário (veterinário ou usuário excluído/inativo): o
 * aviso é descartado. Qualquer outra falha (MS1 fora, 5xx, 401 de token
 * errado) vira erro, para o job tentar de novo.
 */
export class IdentityDirectoryClient implements IRecipientDirectory {
  constructor(
    private readonly baseUrl: string = process.env['MS_IDENTITY_URL'] ?? 'http://localhost:3001',
    private readonly token: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetchFn: Fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  byUser(tenantId: UUID, userId: UUID): Promise<NotificationRecipient | null> {
    return this.getOne(`/internal/tenants/${tenantId}/recipients/users/${userId}`);
  }

  byVeterinarian(tenantId: UUID, veterinarianId: UUID): Promise<NotificationRecipient | null> {
    return this.getOne(`/internal/tenants/${tenantId}/recipients/veterinarians/${veterinarianId}`);
  }

  async tenantAdmins(tenantId: UUID): Promise<NotificationRecipient[]> {
    return (await this.get<NotificationRecipient[]>(`/internal/tenants/${tenantId}/recipients/admins`)) ?? [];
  }

  private getOne(path: string): Promise<NotificationRecipient | null> {
    return this.get<NotificationRecipient>(path);
  }

  private async get<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { [SERVICE_TOKEN_HEADER]: this.token, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new DirectoryUnavailableError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new DirectoryUnavailableError(response.status);
    return (await response.json()) as T;
  }
}
