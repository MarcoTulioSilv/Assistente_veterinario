import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent } from '@quironequine/shared-types';
import { LastVisitService } from './last-visit.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROPERTY_ID = '55555555-5555-5555-5555-555555555555';
const SOURCE_ID = '66666666-6666-6666-6666-666666666666';

function envelope(name: string, payload: Record<string, unknown>): DomainEvent<unknown> {
  return {
    name: name as DomainEvent['name'],
    tenantId: TENANT,
    traceId: 'trace-1',
    idempotencyKey: '77777777-7777-7777-7777-777777777777',
    occurredAt: '2026-11-12T20:00:00.000Z',
    payload,
  };
}

function setup() {
  const record = vi.fn().mockResolvedValue(undefined);
  return { record, service: new LastVisitService({ record }) };
}

describe('LastVisitService', () => {
  it('appointment.done registra a visita na data do atendimento, no tenant do evento', async () => {
    const { service, record } = setup();

    await service.handle(
      'appointment.done',
      envelope('appointment.done', {
        appointmentId: SOURCE_ID,
        ownerId: SOURCE_ID,
        totalCostCents: 1000,
        consumedItems: [],
        performedAt: '2026-11-10T14:00:00.000Z',
        propertyId: PROPERTY_ID,
      }),
    );

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), {
      propertyId: PROPERTY_ID,
      visitedAt: new Date('2026-11-10T14:00:00.000Z'),
      sourceType: 'appointment',
      sourceId: SOURCE_ID,
    });
  });

  it('appointment.done sem performedAt (evento antigo) usa a data do envelope', async () => {
    const { service, record } = setup();

    await service.handle(
      'appointment.done',
      envelope('appointment.done', { appointmentId: SOURCE_ID, propertyId: PROPERTY_ID }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ visitedAt: new Date('2026-11-12T20:00:00.000Z') }),
    );
  });

  it('vaccination.applied registra a visita na data da aplicação', async () => {
    const { service, record } = setup();

    await service.handle(
      'vaccination.applied',
      envelope('vaccination.applied', {
        vaccinationId: SOURCE_ID,
        performedAt: '2026-11-09T12:00:00.000Z',
        propertyId: PROPERTY_ID,
      }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'vaccination', visitedAt: new Date('2026-11-09T12:00:00.000Z') }),
    );
  });

  it('evento publicado antes do propertyId existir é ignorado, sem erro', async () => {
    const { service, record } = setup();

    await service.handle('appointment.done', envelope('appointment.done', { appointmentId: SOURCE_ID }));

    expect(record).not.toHaveBeenCalled();
  });

  it('payload malformado falha (o BullMQ tenta de novo e guarda o job falho)', async () => {
    const { service } = setup();

    await expect(
      service.handle('vaccination.applied', envelope('vaccination.applied', { vaccinationId: 'x' })),
    ).rejects.toThrow();
  });

  it('evento que o MS4 não trata é ignorado', async () => {
    const { service, record } = setup();

    await service.handle('exam.charged', envelope('exam.charged', {}));

    expect(record).not.toHaveBeenCalled();
  });
});
