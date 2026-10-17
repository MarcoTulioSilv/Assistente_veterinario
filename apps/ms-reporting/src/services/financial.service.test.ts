import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, FinancialRecord, DomainEvent } from '@quironequine/shared-types';
import type { FinancialRepository } from '../repositories/financial.repository';
import {
  FinancialService,
  derivePaymentEventKey,
  buildPaymentRegisteredEvent,
} from './financial.service';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 'trace-teste',
};

const RECORD_ID = '33333333-3333-3333-3333-333333333333';
const OWNER_ID = '44444444-4444-4444-4444-444444444444';
const APPOINTMENT_ID = '55555555-5555-5555-5555-555555555555';

function record(overrides: Partial<FinancialRecord> = {}): FinancialRecord {
  return {
    id: RECORD_ID,
    ownerId: OWNER_ID,
    sourceType: 'appointment',
    sourceId: APPOINTMENT_ID,
    amountCents: 27000,
    status: 'pending',
    occurredAt: '2026-09-24T12:00:00.000Z',
    paidAt: null,
    cancelledAt: null,
    createdAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<FinancialRepository> = {}): FinancialRepository {
  return {
    list: vi.fn(),
    listByOwner: vi.fn(),
    findById: vi.fn().mockResolvedValue(record()),
    findBySource: vi.fn().mockResolvedValue(record()),
    recordPending: vi.fn().mockResolvedValue(record()),
    markReceived: vi.fn().mockResolvedValue(record({ status: 'received', paidAt: '2026-09-25T10:00:00.000Z' })),
    cancelBySource: vi.fn().mockResolvedValue('cancelled'),
    ...overrides,
  } as unknown as FinancialRepository;
}

function appointmentDeletedEvent(overrides: Partial<DomainEvent<unknown>> = {}): DomainEvent<unknown> {
  return {
    name: 'appointment.deleted',
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: '88888888-8888-8888-8888-888888888888',
    occurredAt: '2026-10-01T09:00:00.000Z',
    payload: {
      appointmentId: APPOINTMENT_ID,
      ownerId: OWNER_ID,
      totalCostCents: 27000,
      performedAt: '2026-09-30T14:00:00.000Z',
    },
    ...overrides,
  };
}

function appointmentDoneEvent(overrides: Partial<DomainEvent<unknown>> = {}): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    idempotencyKey: '66666666-6666-6666-6666-666666666666',
    occurredAt: '2026-09-24T12:00:00.000Z',
    payload: {
      appointmentId: APPOINTMENT_ID,
      ownerId: OWNER_ID,
      totalCostCents: 27000,
      consumedItems: [{ productId: '77777777-7777-7777-7777-777777777777', quantity: 2 }],
    },
    ...overrides,
  };
}

describe('derivePaymentEventKey', () => {
  it('é determinística — publicar de novo gera a mesma chave', () => {
    expect(derivePaymentEventKey(RECORD_ID)).toBe(derivePaymentEventKey(RECORD_ID));
  });

  it('registros diferentes geram chaves diferentes', () => {
    expect(derivePaymentEventKey(RECORD_ID)).not.toBe(derivePaymentEventKey(OWNER_ID));
  });

  it('tem formato de UUID', () => {
    expect(derivePaymentEventKey(RECORD_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildPaymentRegisteredEvent', () => {
  it('leva os dados que o MS5 precisa pra notificar o proprietário', () => {
    const event = buildPaymentRegisteredEvent(ctx, record({ status: 'received', paidAt: '2026-09-25T10:00:00.000Z' }));

    expect(event.name).toBe('payment.registered');
    expect(event.tenantId).toBe(ctx.tenantId);
    expect(event.payload.ownerId).toBe(OWNER_ID);
    expect(event.payload.amountCents).toBe(27000);
    expect(event.payload.paidAt).toBe('2026-09-25T10:00:00.000Z');
  });
});

describe('FinancialService.handle (RN-002 via broker)', () => {
  it('ignora job que não é appointment.done', async () => {
    const recordPending = vi.fn();
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());

    await service.handle('alert.triggered', appointmentDoneEvent({ name: 'alert.triggered' }));

    expect(recordPending).not.toHaveBeenCalled();
  });

  it('abre a pendência com o total do atendimento e a chave do envelope', async () => {
    const recordPending = vi.fn().mockResolvedValue(record());
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());
    const event = appointmentDoneEvent();

    await service.handle('appointment.done', event);

    expect(recordPending).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      {
        ownerId: OWNER_ID,
        sourceType: 'appointment',
        sourceId: APPOINTMENT_ID,
        amountCents: 27000,
        occurredAt: event.occurredAt,
      },
      event.idempotencyKey,
    );
  });

  it('a data da pendência é a de REALIZAÇÃO do atendimento, não a da finalização', async () => {
    // Feito dia 30, fechado no sistema dia 2: tem que cair no mês 9.
    const recordPending = vi.fn().mockResolvedValue(record());
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());
    const event = appointmentDoneEvent({ occurredAt: '2026-10-02T08:00:00.000Z' });
    (event.payload as Record<string, unknown>)['performedAt'] = '2026-09-30T14:00:00.000Z';

    await service.handle('appointment.done', event);

    expect(recordPending.mock.calls[0]![1].occurredAt).toBe('2026-09-30T14:00:00.000Z');
  });

  it('evento antigo sem performedAt (ainda na fila no deploy) cai na data do envelope', async () => {
    const recordPending = vi.fn().mockResolvedValue(record());
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());

    await service.handle('appointment.done', appointmentDoneEvent({ occurredAt: '2026-01-15T08:00:00.000Z' }));

    expect(recordPending.mock.calls[0]![1].occurredAt).toBe('2026-01-15T08:00:00.000Z');
  });

  it('rejeita payload malformado vindo do broker', async () => {
    const service = new FinancialService(fakeRepo(), vi.fn());

    await expect(
      service.handle('appointment.done', appointmentDoneEvent({ payload: { appointmentId: 'não-é-uuid' } })),
    ).rejects.toThrow();
  });
});

describe('FinancialService.handle — appointment.deleted', () => {
  it('cancela a pendência da origem, com a data de realização do atendimento', async () => {
    const cancelBySource = vi.fn().mockResolvedValue('cancelled');
    const service = new FinancialService(fakeRepo({ cancelBySource }), vi.fn());
    const event = appointmentDeletedEvent();

    await service.handle('appointment.deleted', event);

    expect(cancelBySource).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      {
        ownerId: OWNER_ID,
        sourceType: 'appointment',
        sourceId: APPOINTMENT_ID,
        amountCents: 27000,
        occurredAt: '2026-09-30T14:00:00.000Z',
      },
      event.idempotencyKey,
    );
  });

  it('atendimento já pago: mantém o pagamento e não falha (o job não pode ficar em retry)', async () => {
    const service = new FinancialService(
      fakeRepo({ cancelBySource: vi.fn().mockResolvedValue('kept-received') }),
      vi.fn(),
    );

    await expect(service.handle('appointment.deleted', appointmentDeletedEvent())).resolves.toBeUndefined();
  });

  it('não confunde os eventos: appointment.deleted não abre pendência', async () => {
    const recordPending = vi.fn();
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());

    await service.handle('appointment.deleted', appointmentDeletedEvent());

    expect(recordPending).not.toHaveBeenCalled();
  });

  it('rejeita payload malformado vindo do broker', async () => {
    const service = new FinancialService(fakeRepo(), vi.fn());

    await expect(
      service.handle('appointment.deleted', appointmentDeletedEvent({ payload: { appointmentId: 'x' } })),
    ).rejects.toThrow();
  });
});

describe('FinancialService.registerPayment (RN-002)', () => {
  it('pendência cancelada não pode ser paga — e a mensagem diz o porquê', async () => {
    const service = new FinancialService(
      fakeRepo({
        markReceived: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(record({ status: 'cancelled' })),
      }),
      vi.fn(),
    );

    await expect(service.registerPayment(ctx, RECORD_ID)).rejects.toThrow(/de origem foi excluído/);
  });

  it('marca como recebido e publica payment.registered', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new FinancialService(fakeRepo(), publish);

    const result = await service.registerPayment(ctx, RECORD_ID);

    expect(result.status).toBe('received');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].name).toBe('payment.registered');
  });

  it('rejeita registro inexistente', async () => {
    const service = new FinancialService(
      fakeRepo({ markReceived: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue(null) }),
      vi.fn(),
    );

    await expect(service.registerPayment(ctx, RECORD_ID)).rejects.toThrow(/não encontrado/);
  });

  it('rejeita registrar pagamento duas vezes', async () => {
    const service = new FinancialService(
      fakeRepo({
        markReceived: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(record({ status: 'received' })),
      }),
      vi.fn(),
    );

    await expect(service.registerPayment(ctx, RECORD_ID)).rejects.toThrow(/já registrado/);
  });

  it('falha ao publicar NÃO desfaz o pagamento — o fato de negócio já está commitado', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('Redis fora do ar'));
    const service = new FinancialService(fakeRepo(), publish);

    const result = await service.registerPayment(ctx, RECORD_ID);

    expect(result.status).toBe('received');
  });
});

describe('FinancialService — delegações', () => {
  it('list, listByOwner e findBySource repassam pro repositório', async () => {
    const paginado = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    const list = vi.fn().mockResolvedValue(paginado);
    const listByOwner = vi.fn().mockResolvedValue(paginado);
    const findBySource = vi.fn().mockResolvedValue(null);
    const service = new FinancialService(fakeRepo({ list, listByOwner, findBySource }), vi.fn());

    await service.list(ctx, { page: 1, limit: 20 });
    await service.listByOwner(ctx, OWNER_ID, { page: 1, limit: 20 });
    await service.findBySource(ctx, 'appointment', APPOINTMENT_ID);

    expect(list).toHaveBeenCalledWith(ctx, { page: 1, limit: 20 });
    expect(listByOwner).toHaveBeenCalledWith(ctx, OWNER_ID, { page: 1, limit: 20 });
    expect(findBySource).toHaveBeenCalledWith(ctx, 'appointment', APPOINTMENT_ID);
  });

  it('recordPending repassa a chave de idempotência', async () => {
    const recordPending = vi.fn().mockResolvedValue(record());
    const service = new FinancialService(fakeRepo({ recordPending }), vi.fn());

    await service.recordPending(
      ctx,
      { ownerId: OWNER_ID, sourceType: 'exam', sourceId: APPOINTMENT_ID, amountCents: 100, occurredAt: '2026-09-24T12:00:00.000Z' },
      '66666666-6666-6666-6666-666666666666',
    );

    expect(recordPending).toHaveBeenCalledWith(ctx, expect.objectContaining({ sourceType: 'exam' }), '66666666-6666-6666-6666-666666666666');
  });
});

describe('FinancialService.handle — exame', () => {
  const EXAM_ID = '99999999-9999-9999-9999-999999999999';

  function examEvent(name: 'exam.charged' | 'exam.deleted'): DomainEvent<unknown> {
    return {
      name,
      tenantId: ctx.tenantId,
      traceId: ctx.traceId,
      idempotencyKey: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      occurredAt: '2026-10-02T09:00:00.000Z',
      payload: {
        examRequestId: EXAM_ID,
        ownerId: OWNER_ID,
        totalCostCents: 44000,
        performedAt: '2026-10-01T10:00:00.000Z',
      },
    };
  }

  const expected = {
    ownerId: OWNER_ID,
    sourceType: 'exam',
    sourceId: EXAM_ID,
    amountCents: 44000,
    occurredAt: '2026-10-01T10:00:00.000Z',
  };

  it('exam.charged abre a pendência do exame com a data da coleta', async () => {
    const repo = fakeRepo();
    await new FinancialService(repo, vi.fn()).handle('exam.charged', examEvent('exam.charged'));

    expect(repo.recordPending).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      expected,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(repo.cancelBySource).not.toHaveBeenCalled();
  });

  it('exam.deleted cancela a pendência do exame', async () => {
    const repo = fakeRepo();
    await new FinancialService(repo, vi.fn()).handle('exam.deleted', examEvent('exam.deleted'));

    expect(repo.cancelBySource).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      expected,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(repo.recordPending).not.toHaveBeenCalled();
  });

  it('rejeita payload de exame malformado', async () => {
    const service = new FinancialService(fakeRepo(), vi.fn());
    const event = { ...examEvent('exam.charged'), payload: { examRequestId: EXAM_ID } };

    await expect(service.handle('exam.charged', event)).rejects.toThrow();
  });
});

describe('FinancialService.handle — vacinação', () => {
  const VACCINATION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function vaccinationEvent(name: 'vaccination.applied' | 'vaccination.deleted', totalCostCents = 18000): DomainEvent<unknown> {
    return {
      name,
      tenantId: ctx.tenantId,
      traceId: ctx.traceId,
      idempotencyKey: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      occurredAt: '2026-10-09T09:00:00.000Z',
      payload: {
        vaccinationId: VACCINATION_ID,
        ownerId: OWNER_ID,
        // Campos que só o MS2 usa — o schema do MS6 ignora.
        productId: '77777777-7777-7777-7777-777777777777',
        totalDoses: 2,
        totalCostCents,
        performedAt: '2026-10-08T12:00:00.000Z',
      },
    };
  }

  const expected = {
    ownerId: OWNER_ID,
    sourceType: 'vaccination',
    sourceId: VACCINATION_ID,
    amountCents: 18000,
    occurredAt: '2026-10-08T12:00:00.000Z',
  };

  it('vaccination.applied abre a pendência com a data da aplicação', async () => {
    const repo = fakeRepo();
    await new FinancialService(repo, vi.fn()).handle('vaccination.applied', vaccinationEvent('vaccination.applied'));

    expect(repo.recordPending).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      expected,
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
  });

  it('aplicação sem custo não abre pendência', async () => {
    const repo = fakeRepo();
    await new FinancialService(repo, vi.fn()).handle('vaccination.applied', vaccinationEvent('vaccination.applied', 0));

    expect(repo.recordPending).not.toHaveBeenCalled();
  });

  it('vaccination.deleted cancela a pendência da vacinação', async () => {
    const repo = fakeRepo();
    await new FinancialService(repo, vi.fn()).handle('vaccination.deleted', vaccinationEvent('vaccination.deleted'));

    expect(repo.cancelBySource).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenantId }),
      expected,
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    expect(repo.recordPending).not.toHaveBeenCalled();
  });

  it('rejeita payload de vacinação malformado', async () => {
    const service = new FinancialService(fakeRepo(), vi.fn());
    const event = { ...vaccinationEvent('vaccination.applied'), payload: { vaccinationId: VACCINATION_ID } };

    await expect(service.handle('vaccination.applied', event)).rejects.toThrow();
  });
});
