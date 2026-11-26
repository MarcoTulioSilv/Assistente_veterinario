import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { EmailSender, AccountEmailKind } from '../channels/channels';
import { accountEmailSchema } from '../schemas/event-payloads';

const log = createServiceLogger('account-email-service');

/**
 * Telas da PWA que recebem o token (Dev 2): o link do e-mail abre uma delas
 * com `?token=...`.
 */
export const ACCOUNT_LINK_PATHS: Record<AccountEmailKind, string> = {
  verify_email: '/confirmar-email',
  reset_password: '/redefinir-senha',
};

const KIND_BY_EVENT: Record<string, AccountEmailKind> = {
  [EVENTS.AUTH_EMAIL_VERIFICATION_REQUESTED]: 'verify_email',
  [EVENTS.AUTH_PASSWORD_RESET_REQUESTED]: 'reset_password',
};

/**
 * Lógica de negócio — Dev 1 é o dono. Envia os e-mails da conta que o MS1
 * pede (confirmação de cadastro, nova senha — auditoria M-02, ADR-007).
 *
 * O token NUNCA é gravado nem vai para log: existe só no evento (que o MS1
 * publica com remoção ao terminar) e no link. Com o e-mail desligado, o
 * evento é só descartado.
 */
export class AccountEmailService {
  constructor(
    private readonly email: EmailSender | null,
    private readonly appUrl: string = process.env['APP_URL'] ?? 'http://localhost:3100',
  ) {}

  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    const kind = KIND_BY_EVENT[jobName];
    if (!kind) return;
    const payload = accountEmailSchema.parse(event.payload);

    if (!this.email) {
      log.info({ kind, userId: payload.userId }, 'E-mail desligado — e-mail da conta não enviado');
      return;
    }

    const link = `${this.appUrl.replace(/\/$/, '')}${ACCOUNT_LINK_PATHS[kind]}?token=${encodeURIComponent(payload.token)}`;
    await this.email.sendAccountEmail(kind, payload.email, link, new Date(payload.expiresAt));
    log.info({ kind, userId: payload.userId }, 'E-mail da conta enviado');
  }
}
