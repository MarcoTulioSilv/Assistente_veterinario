import type { NotificationData, PushMessage } from '@quironequine/shared-types';

/**
 * Interfaces dos canais de entrega — Dev 1 publica, Dev 2 implementa os
 * adapters (Plano de Trabalho: "Adapters externos" são do Dev 2): Web Push
 * com VAPID (lib `web-push`), WhatsApp Business API (Cloud API da Meta) e
 * e-mail. O texto das mensagens mora nos adapters e na PWA (ADR-007): o MS5
 * entrega só tipo e dados.
 */

/** `gone`: o serviço de push respondeu 404/410 — a assinatura não existe mais. */
export type PushOutcome = 'sent' | 'gone';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

export interface WhatsAppSender {
  send(phone: string, data: NotificationData): Promise<void>;
}

export type AccountEmailKind = 'verify_email' | 'reset_password';

export interface EmailSender {
  /** Aviso de notificação por e-mail (RF-NOT-003). */
  sendNotification(to: string, data: NotificationData): Promise<void>;
  /** E-mail da conta (confirmação, nova senha), com o link que leva o token. */
  sendAccountEmail(kind: AccountEmailKind, to: string, link: string, expiresAt: Date): Promise<void>;
}

/**
 * Canais disponíveis neste processo. `null` = canal desligado: sem adapter
 * ou sem a chave ligada (WhatsApp e e-mail ficam desligados até existirem as
 * contas — decisão de 12/11/2026; push precisa das chaves VAPID).
 */
export interface Channels {
  push: PushSender | null;
  whatsapp: WhatsAppSender | null;
  email: EmailSender | null;
}

/** Chave pública VAPID (vazia = push desligado no servidor). */
export function vapidPublicKey(): string {
  return process.env['VAPID_PUBLIC_KEY'] ?? '';
}

export interface ChannelAdapters {
  push?: PushSender;
  whatsapp?: WhatsAppSender;
  email?: EmailSender;
}

/**
 * Monta os canais a partir dos adapters existentes e das chaves:
 * - push: adapter + VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY configuradas;
 * - WhatsApp: adapter + WHATSAPP_ENABLED=true;
 * - e-mail: adapter + EMAIL_ENABLED=true.
 *
 * O Dev 2 passa os adapters reais em index.ts quando existirem.
 */
export function buildChannels(adapters: ChannelAdapters, env: NodeJS.ProcessEnv = process.env): Channels {
  const vapidReady = !!env['VAPID_PUBLIC_KEY'] && !!env['VAPID_PRIVATE_KEY'];
  return {
    push: vapidReady ? (adapters.push ?? null) : null,
    whatsapp: env['WHATSAPP_ENABLED'] === 'true' ? (adapters.whatsapp ?? null) : null,
    email: env['EMAIL_ENABLED'] === 'true' ? (adapters.email ?? null) : null,
  };
}
