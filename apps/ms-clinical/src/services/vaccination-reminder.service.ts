import { randomUUID } from 'node:crypto';
import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent, VaccinationDuePayload } from '@quironequine/shared-types';
import type { VaccinationRepository, DueVaccinationRow } from '../repositories/vaccination.repository';
import { publishDomainEvent } from '../events/publisher';
import { deriveEventIdempotencyKey } from './billing';
import { saoPauloDay, addDays } from './sao-paulo-day';
import { BOOSTER_DUE_SOON_DAYS } from './vaccination.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Qual lembrete a dose recebe hoje, se algum: 7 dias antes ou no dia. */
export function vaccinationReminderKind(nextDoseAt: Date, now: Date): VaccinationDuePayload['kind'] | null {
  const today = saoPauloDay(now);
  const due = saoPauloDay(nextDoseAt);
  if (due === today) return 'due_today';
  if (due === addDays(today, BOOSTER_DUE_SOON_DAYS)) return 'week_before';
  return null;
}

/** Junta as linhas por aplicação: um aviso por aplicação, com os animais que faltam. */
export function groupByVaccination(rows: DueVaccinationRow[]): Array<{ row: DueVaccinationRow; animalIds: string[] }> {
  const groups = new Map<string, { row: DueVaccinationRow; animalIds: string[] }>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (group) group.animalIds.push(row.animalId);
    else groups.set(row.id, { row, animalIds: [row.animalId] });
  }
  return [...groups.values()];
}

export function buildVaccinationDueEvent(
  row: DueVaccinationRow,
  animalIds: string[],
  kind: VaccinationDuePayload['kind'],
): DomainEvent<VaccinationDuePayload> {
  return {
    name: EVENTS.VACCINATION_DUE,
    tenantId: row.tenantId,
    traceId: `vaccination-reminder-${randomUUID()}`,
    // Derivada de (aplicação, tipo de lembrete): o job rodar duas vezes no
    // mesmo dia não manda o aviso duas vezes — o jobId repetido é descartado.
    idempotencyKey: deriveEventIdempotencyKey(`${EVENTS.VACCINATION_DUE}:${kind}`, row.id),
    occurredAt: new Date().toISOString(),
    payload: {
      vaccinationId: row.id,
      ownerId: row.ownerId,
      propertyId: row.propertyId,
      veterinarianId: row.veterinarianId,
      vaccineName: row.vaccineName,
      animalIds,
      nextDoseAt: row.nextDoseAt.toISOString(),
      kind,
    },
  };
}

/**
 * Lembrete de re-vacinação (RF-VAC-005): 7 dias antes e no dia da próxima
 * dose (decisão do Marco). O MS3 detecta e publica; quem entrega (push e
 * notificação) é o MS5.
 *
 * Mesmo desenho do ExamReminderService: publica direto, sem outbox, porque
 * é varredura de leitura; uma falha não segura os outros avisos, mas falha o
 * job pro BullMQ tentar de novo (a chave derivada evita duplicata).
 */
export class VaccinationReminderService {
  constructor(
    private readonly repo: Pick<VaccinationRepository, 'listDueAcrossTenants'>,
    private readonly publish: (event: DomainEvent<VaccinationDuePayload>) => Promise<void> = publishDomainEvent,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Devolve quantos avisos publicou. */
  async run(): Promise<number> {
    const now = this.now();
    // Janela folgada em volta de hoje e de hoje+7: a classificação exata é
    // feita aqui, no fuso de São Paulo, e não no SQL.
    const rows = await this.repo.listDueAcrossTenants(
      new Date(now.getTime() - 2 * DAY_MS),
      new Date(now.getTime() + (BOOSTER_DUE_SOON_DAYS + 2) * DAY_MS),
    );

    const errors: unknown[] = [];
    let published = 0;
    for (const { row, animalIds } of groupByVaccination(rows)) {
      const kind = vaccinationReminderKind(row.nextDoseAt, now);
      if (!kind) continue;
      try {
        await this.publish(buildVaccinationDueEvent(row, animalIds, kind));
        published++;
      } catch (err) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} lembrete(s) de re-vacinação não publicado(s)`);
    }
    return published;
  }
}
