import { EVENTS } from '@quironequine/shared-types';
import type {
  DomainEvent,
  IRecipientDirectory,
  NotificationData,
  NotificationTarget,
  NotificationChannel,
  UUID,
} from '@quironequine/shared-types';
import { createServiceLogger, saoPauloDay } from '@quironequine/shared-middlewares';
import type { NotificationRepository } from '../repositories/notification.repository';
import type { PreferenceRepository } from '../repositories/preference.repository';
import type { Channels } from '../channels/channels';
import type { DeliveryJob } from '../events/delivery-queue';
import {
  scheduleReminderDueSchema,
  examResultDueSchema,
  vaccinationDueSchema,
  alertTriggeredSchema,
} from '../schemas/event-payloads';
import { NOTIFICATION_CHANNELS } from './notification.service';

const log = createServiceLogger('ingest-service');

/** Alerta de estoque mais velho que isto, ao chegar, só vai para a caixa de entrada. */
export const ALERT_FRESH_MS = 24 * 60 * 60 * 1000;

/** Quem recebe o aviso. */
type Audience = { userId: UUID } | { veterinarianId: UUID } | { tenantAdmins: true };

/** O que um evento vira: para quem, o quê, e se ainda vale incomodar com push. */
export interface Plan {
  audience: Audience;
  data: NotificationData;
  target: NotificationTarget;
  /** Lembrete vencido: só caixa de entrada, sem entrega por canal. */
  stale: boolean;
}

/**
 * Evento → aviso. `null` = evento que o MS5 não transforma em aviso
 * (`payment.registered`: decisão de 12/11/2026, nada vai ao proprietário).
 */
export function planFor(event: DomainEvent<unknown>, now: Date): Plan | null {
  const today = saoPauloDay(now);
  switch (event.name) {
    case EVENTS.SCHEDULE_REMINDER_DUE: {
      const p = scheduleReminderDueSchema.parse(event.payload);
      return {
        audience: { userId: p.recipientUserId },
        data: {
          type: 'schedule_reminder',
          activityType: p.activityType,
          startsAt: p.startsAt,
          minutesBefore: p.minutesBefore,
          propertyId: p.propertyId,
        },
        target: { kind: 'schedule_event', id: p.scheduleEventId },
        // O evento da agenda já começou.
        stale: new Date(p.startsAt).getTime() <= now.getTime(),
      };
    }
    case EVENTS.EXAM_RESULT_DUE: {
      const p = examResultDueSchema.parse(event.payload);
      return {
        audience: { veterinarianId: p.veterinarianId },
        data: { type: 'exam_result_due', examTypeName: p.examTypeName, expectedResultAt: p.expectedResultAt, kind: p.kind },
        target: { kind: 'exam_request', id: p.examRequestId },
        stale: saoPauloDay(new Date(p.expectedResultAt)) < today,
      };
    }
    case EVENTS.VACCINATION_DUE: {
      const p = vaccinationDueSchema.parse(event.payload);
      return {
        audience: { veterinarianId: p.veterinarianId },
        data: {
          type: 'vaccination_due',
          vaccineName: p.vaccineName,
          nextDoseAt: p.nextDoseAt,
          kind: p.kind,
          animalCount: p.animalIds.length,
          propertyId: p.propertyId,
        },
        target: { kind: 'vaccination', id: p.vaccinationId },
        stale: saoPauloDay(new Date(p.nextDoseAt)) < today,
      };
    }
    case EVENTS.ALERT_TRIGGERED: {
      const p = alertTriggeredSchema.parse(event.payload);
      const data: NotificationData =
        p.alertType === 'expiry'
          ? { type: 'stock_expiry', productName: p.productName, expiryDate: p.expiryDate ?? null }
          : { type: 'stock_low', productName: p.productName, quantityInStock: p.quantityInStock ?? null };
      return {
        audience: { tenantAdmins: true },
        data,
        target: { kind: 'product', id: p.productId },
        stale: now.getTime() - new Date(event.occurredAt).getTime() > ALERT_FRESH_MS,
      };
    }
    default:
      return null;
  }
}

/** Os e-mails da conta seguem outro caminho (AccountEmailService). */
const ACCOUNT_EVENTS: ReadonlySet<string> = new Set([
  EVENTS.AUTH_EMAIL_VERIFICATION_REQUESTED,
  EVENTS.AUTH_PASSWORD_RESET_REQUESTED,
]);

export interface IngestDeps {
  notifications: Pick<NotificationRepository, 'createIfAbsent'>;
  preferences: Pick<PreferenceRepository, 'isEnabled'>;
  directory: IRecipientDirectory;
  channels: Channels;
  enqueue: (job: DeliveryJob) => Promise<void>;
  accountEmails: { handle(jobName: string, event: DomainEvent<unknown>): Promise<void> };
  now?: () => Date;
}

/**
 * Lógica de negócio — Dev 1 é o dono. Consome a fila `domain-events-notification`
 * (ADR-002, ADR-007): descobre quem avisar, grava a caixa de entrada e
 * enfileira uma entrega por canal ligado.
 *
 * Idempotente: o mesmo evento não gera um segundo item para o mesmo
 * usuário (UNIQUE), e só item NOVO é entregue — redelivery não repete push.
 * Lembrete vencido (a fila acumulou desde o M2) fica só na caixa de entrada.
 */
export class IngestService {
  private readonly now: () => Date;

  constructor(private readonly deps: IngestDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    if (ACCOUNT_EVENTS.has(jobName)) return this.deps.accountEmails.handle(jobName, event);

    const plan = planFor({ ...event, name: jobName as DomainEvent['name'] }, this.now());
    if (!plan) {
      log.info({ jobName }, 'Evento sem aviso para o veterinário — descartado');
      return;
    }

    const userIds = await this.resolve(event.tenantId, plan.audience);
    if (userIds.length === 0) {
      log.info({ jobName, tenantId: event.tenantId }, 'Sem destinatário ativo — aviso descartado');
      return;
    }

    for (const userId of userIds) {
      const { id, created } = await this.deps.notifications.createIfAbsent({
        tenantId: event.tenantId,
        userId,
        data: plan.data,
        target: plan.target,
        idempotencyKey: event.idempotencyKey,
      });
      if (!created || plan.stale) continue;
      for (const channel of await this.channelsFor(event.tenantId, userId, plan.data.type)) {
        await this.deps.enqueue({ tenantId: event.tenantId, notificationId: id, userId, channel });
      }
    }
  }

  private async resolve(tenantId: UUID, audience: Audience): Promise<UUID[]> {
    if ('userId' in audience) return [audience.userId];
    if ('veterinarianId' in audience) {
      const recipient = await this.deps.directory.byVeterinarian(tenantId, audience.veterinarianId);
      return recipient ? [recipient.userId] : [];
    }
    return (await this.deps.directory.tenantAdmins(tenantId)).map((r) => r.userId);
  }

  /** Canais ligados no servidor e não desligados pelo usuário (RF-NOT-003). */
  private async channelsFor(tenantId: UUID, userId: UUID, type: NotificationData['type']): Promise<NotificationChannel[]> {
    const result: NotificationChannel[] = [];
    for (const channel of NOTIFICATION_CHANNELS) {
      if (this.deps.channels[channel] === null) continue;
      if (await this.deps.preferences.isEnabled(tenantId, userId, type, channel)) result.push(channel);
    }
    return result;
  }
}
