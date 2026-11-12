import { EVENTS } from '@quironequine/shared-types';
import type { DomainEvent, RequestContext, UUID } from '@quironequine/shared-types';
import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { LastVisitRepository, VisitData } from '../repositories/last-visit.repository';
import { appointmentDoneVisitSchema, vaccinationAppliedVisitSchema } from '../schemas/event-payloads';

const log = createServiceLogger('last-visit-service');
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

function systemCtx(tenantId: UUID, traceId: string): RequestContext {
  return { tenantId, userId: SYSTEM_USER_ID, role: 'admin', plan: 'plus', traceId };
}

/**
 * Lógica de negócio — Dev 1 é o dono.
 *
 * Última visita a cada propriedade, a base do "sem visita há mais de X dias"
 * do geofence (Sprint 11, RN-008). Visita = atendimento finalizado ou
 * vacinação aplicada pela clínica (a externa não publica evento), além da
 * conclusão de um evento da agenda (ScheduleEventRepository.complete).
 *
 * Idempotente e independente de ordem: o repositório só avança a data
 * (ver upsertLastVisit), então redelivery e retry fora de ordem não mudam o
 * resultado.
 */
export class LastVisitService {
  constructor(private readonly repo: Pick<LastVisitRepository, 'record'>) {}

  /** Roteamento por nome do job — a fila `domain-events-scheduling` é só deste serviço. */
  async handle(jobName: string, event: DomainEvent<unknown>): Promise<void> {
    if (jobName === EVENTS.APPOINTMENT_DONE) return this.onAppointmentDone(event);
    if (jobName === EVENTS.VACCINATION_APPLIED) return this.onVaccinationApplied(event);
    log.warn({ jobName, traceId: event.traceId }, 'Evento sem tratamento no MS4 — ignorado');
  }

  private async onAppointmentDone(event: DomainEvent<unknown>): Promise<void> {
    const payload = appointmentDoneVisitSchema.parse(event.payload);
    await this.record(event, {
      propertyId: payload.propertyId,
      // Data do atendimento; eventos antigos sem ela caem no envelope.
      visitedAt: new Date(payload.performedAt ?? event.occurredAt),
      sourceType: 'appointment',
      sourceId: payload.appointmentId,
    });
  }

  private async onVaccinationApplied(event: DomainEvent<unknown>): Promise<void> {
    const payload = vaccinationAppliedVisitSchema.parse(event.payload);
    await this.record(event, {
      propertyId: payload.propertyId,
      visitedAt: new Date(payload.performedAt),
      sourceType: 'vaccination',
      sourceId: payload.vaccinationId,
    });
  }

  private async record(
    event: DomainEvent<unknown>,
    visit: Omit<VisitData, 'propertyId'> & { propertyId: UUID | undefined },
  ): Promise<void> {
    if (!visit.propertyId) {
      // Publicado antes do MS3 mandar a propriedade — não há onde registrar.
      log.info({ jobName: event.name, sourceId: visit.sourceId }, 'Evento sem propertyId — visita não registrada');
      return;
    }
    await this.repo.record(systemCtx(event.tenantId, event.traceId), { ...visit, propertyId: visit.propertyId });
    log.info({ sourceType: visit.sourceType, sourceId: visit.sourceId }, 'Última visita à propriedade registrada');
  }
}
