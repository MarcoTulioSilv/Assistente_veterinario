import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, ExamRequest, ExamType, DomainEvent } from '@quironequine/shared-types';
import type { ExamRepository, ExamAdvanceData } from '../repositories/exam.repository';
import type { ExamTypeRepository } from '../repositories/exam-type.repository';
import {
  ExamService,
  calculateExamChargeCents,
  calculateExpectedResultAt,
  countSubjects,
  generatedPendency,
} from './exam.service';
import { deriveEventIdempotencyKey } from './billing';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 'trace-teste',
};

const EXAM_ID = '33333333-3333-3333-3333-333333333333';
const TYPE_ID = '44444444-4444-4444-4444-444444444444';
const PRODUCT_ID = '55555555-5555-5555-5555-555555555555';
const ANIMAL_A = '66666666-6666-6666-6666-666666666666';
const ANIMAL_B = '77777777-7777-7777-7777-777777777777';

function examType(overrides: Partial<ExamType> = {}): ExamType {
  return {
    id: TYPE_ID,
    name: 'Mormo',
    defaultPriceCents: 15000,
    expectedTurnaroundDays: 5,
    protocolFields: [{ key: 'laboratorio', label: 'Laboratório', type: 'text', required: true }],
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

/** O exemplo revisado com o Marco: 2 animais, R$ 150/animal, R$ 80 de mão de obra, 30 km × R$ 2, 2 tubos de R$ 5. */
function exam(overrides: Partial<ExamRequest> = {}): ExamRequest {
  return {
    id: EXAM_ID,
    ownerId: '88888888-8888-8888-8888-888888888888',
    propertyId: '99999999-9999-9999-9999-999999999999',
    veterinarianId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    examTypeId: TYPE_ID,
    examTypeName: 'Mormo',
    protocolFields: examType().protocolFields,
    protocolData: { laboratorio: 'LANAGRO' },
    material: null,
    collectedAt: null,
    animalIds: [ANIMAL_A, ANIMAL_B],
    lotDescription: null,
    lotSize: null,
    status: 'requested',
    expectedResultAt: null,
    resultFileUrl: null,
    resultUploadedAt: null,
    paidDirectlyByClient: false,
    unitPriceCents: 15000,
    laborCents: 0,
    displacementKm: 0,
    displacementRateCents: 0,
    totalCents: 0,
    chargedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    items: [],
    ...overrides,
  };
}

const COLLECTION = {
  material: 'Sangue',
  collectedAt: '2026-10-01T10:00:00.000Z',
  laborCents: 8000,
  displacementKm: 30,
  displacementRateCents: 200,
  items: [{ productId: PRODUCT_ID, description: 'Tubo', quantity: 2, unitPriceCents: 500 }],
};

interface FinalizeResult {
  data?: Partial<ExamAdvanceData>;
  events?: DomainEvent<unknown>[];
}

/**
 * O `advance` falso imita o real: aplica o UPDATE no pedido "travado" e
 * chama o `finalize` com ele. Guarda o resultado pra os testes olharem
 * total e eventos.
 */
function setup(current: ExamRequest, type: ExamType | null = examType()) {
  const captured: { data?: ExamAdvanceData; finalized?: FinalizeResult } = {};
  const advance = vi.fn(
    async (
      _ctx: RequestContext,
      _id: string,
      _from: string[],
      data: ExamAdvanceData,
      extras: { items?: Array<{ productId: string; quantity: number; totalCents: number; description: string; unitPriceCents: number }>; finalize?: (locked: ExamRequest) => FinalizeResult } = {},
    ): Promise<ExamRequest | null> => {
      captured.data = data;
      const locked: ExamRequest = {
        ...current,
        ...(data as Partial<ExamRequest>),
        collectedAt: data.collectedAt ? data.collectedAt.toISOString() : current.collectedAt,
        chargedAt: data.chargedAt ? data.chargedAt.toISOString() : current.chargedAt,
        expectedResultAt: data.expectedResultAt ? data.expectedResultAt.toISOString() : current.expectedResultAt,
        resultUploadedAt: data.resultUploadedAt ? data.resultUploadedAt.toISOString() : current.resultUploadedAt,
        items: (extras.items ?? []).map((item, index) => ({ id: `i${index}`, ...item })),
      };
      if (extras.finalize) captured.finalized = extras.finalize(locked);
      return locked;
    },
  );

  const repo = {
    list: vi.fn(),
    listByAnimal: vi.fn(),
    findById: vi.fn().mockResolvedValue(current),
    create: vi.fn().mockImplementation(async (_ctx, data) => ({ ...current, ...data })),
    update: vi.fn().mockResolvedValue(current),
    advance,
    softDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExamRepository;

  const types = {
    findById: vi.fn().mockResolvedValue(type),
  } as unknown as ExamTypeRepository;

  return { service: new ExamService(repo, types), repo, types, advance, captured };
}

function eventNames(result: FinalizeResult | undefined): string[] {
  return (result?.events ?? []).map((event) => event.name);
}

describe('calculateExamChargeCents (RF-EXM-006 + decisão dos stakeholders)', () => {
  const collection = { laborCents: 8000, displacementKm: 30, displacementRateCents: 200, items: [{ totalCents: 1000 }] };

  it('caso 1 — vet coletou e cobra o exame: procedimento × animais + mão de obra + km, sem insumos', () => {
    expect(
      calculateExamChargeCents({ paidDirectlyByClient: false, unitPriceCents: 15000, subjects: 2, collection }),
    ).toBe(44000);
  });

  it('caso 2 — vet coletou e o cliente pagou o laboratório: mão de obra + km + insumos', () => {
    expect(
      calculateExamChargeCents({ paidDirectlyByClient: true, unitPriceCents: 15000, subjects: 2, collection }),
    ).toBe(15000);
  });

  it('caso 3 — não coletou e o cliente pagou o laboratório: nada', () => {
    expect(
      calculateExamChargeCents({ paidDirectlyByClient: true, unitPriceCents: 15000, subjects: 2, collection: null }),
    ).toBe(0);
  });

  it('caso 4 — não coletou e cobra o exame: só procedimento × animais', () => {
    expect(
      calculateExamChargeCents({ paidDirectlyByClient: false, unitPriceCents: 15000, subjects: 2, collection: null }),
    ).toBe(30000);
  });
});

describe('regras auxiliares', () => {
  it('conta animais identificados + cabeças do lote', () => {
    expect(countSubjects({ animalIds: [ANIMAL_A], lotSize: 10 })).toBe(11);
    expect(countSubjects({ animalIds: [], lotSize: null })).toBe(0);
  });

  it('data prevista = base + prazo; sem prazo, sem data', () => {
    const base = new Date('2026-10-01T10:00:00.000Z');
    expect(calculateExpectedResultAt(base, 5)?.toISOString()).toBe('2026-10-06T10:00:00.000Z');
    expect(calculateExpectedResultAt(base, null)).toBeNull();
  });

  it('só cobrança fechada COM valor gerou pendência', () => {
    expect(generatedPendency({ chargedAt: '2026-10-01T10:00:00.000Z', totalCents: 100 })).toBe(true);
    expect(generatedPendency({ chargedAt: '2026-10-01T10:00:00.000Z', totalCents: 0 })).toBe(false);
    expect(generatedPendency({ chargedAt: null, totalCents: 0 })).toBe(false);
  });
});

describe('ExamService.create', () => {
  it('copia nome e campos do tipo, sugere o preço dele e tira animal repetido', async () => {
    const { service, repo } = setup(exam({ status: 'draft' }));

    await service.create(ctx, {
      ownerId: exam().ownerId,
      propertyId: exam().propertyId,
      veterinarianId: exam().veterinarianId,
      examTypeId: TYPE_ID,
      animalIds: [ANIMAL_A, ANIMAL_A, ANIMAL_B],
    });

    expect(repo.create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        examTypeName: 'Mormo',
        protocolFields: examType().protocolFields,
        unitPriceCents: 15000,
        paidDirectlyByClient: false,
        animalIds: [ANIMAL_A, ANIMAL_B],
      }),
    );
  });

  it('rascunho aceita obrigatório em branco, mas não campo que o protocolo não tem', async () => {
    const { service } = setup(exam({ status: 'draft' }));
    const base = {
      ownerId: exam().ownerId,
      propertyId: exam().propertyId,
      veterinarianId: exam().veterinarianId,
      examTypeId: TYPE_ID,
    };

    await expect(service.create(ctx, base)).resolves.toBeDefined();
    await expect(service.create(ctx, { ...base, protocolData: { inventado: 'x' } })).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('tipo inexistente é 404', async () => {
    const { service } = setup(exam(), null);
    await expect(
      service.create(ctx, {
        ownerId: exam().ownerId,
        propertyId: exam().propertyId,
        veterinarianId: exam().veterinarianId,
        examTypeId: TYPE_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('ExamService.issue', () => {
  it('rascunho completo vira solicitado', async () => {
    const { service, captured } = setup(exam({ status: 'draft' }));
    await service.issue(ctx, EXAM_ID);
    expect(captured.data).toEqual({ status: 'requested' });
  });

  it('sem animais nem lote não emite', async () => {
    const { service } = setup(exam({ status: 'draft', animalIds: [] }));
    await expect(service.issue(ctx, EXAM_ID)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('obrigatório do protocolo em branco não emite', async () => {
    const { service } = setup(exam({ status: 'draft', protocolData: {} }));
    await expect(service.issue(ctx, EXAM_ID)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('pedido já emitido é 409', async () => {
    const { service } = setup(exam({ status: 'requested' }));
    await expect(service.issue(ctx, EXAM_ID)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('ExamService.update', () => {
  it('cobrança fechada não edita', async () => {
    const { service } = setup(exam({ status: 'collected', chargedAt: '2026-10-01T10:00:00.000Z' }));
    await expect(service.update(ctx, EXAM_ID, { unitPriceCents: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('pedido emitido não pode ficar sem animais', async () => {
    const { service } = setup(exam());
    await expect(service.update(ctx, EXAM_ID, { animalIds: [] })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('trocar o tipo troca a cópia dos campos, mantém o que existe no tipo novo e sugere o preço novo', async () => {
    const novo = examType({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'AIE',
      defaultPriceCents: 9000,
      protocolFields: [{ key: 'laboratorio', label: 'Laboratório', type: 'text', required: false }],
    });
    const { service, repo } = setup(exam({ status: 'draft', protocolData: { laboratorio: 'LANAGRO' } }), novo);

    await service.update(ctx, EXAM_ID, { examTypeId: novo.id });

    expect(repo.update).toHaveBeenCalledWith(
      ctx,
      EXAM_ID,
      expect.objectContaining({
        examTypeId: novo.id,
        examTypeName: 'AIE',
        unitPriceCents: 9000,
        protocolData: { laboratorio: 'LANAGRO' },
      }),
    );
  });
});

describe('ExamService.registerCollection', () => {
  it('caso 1 — vet coletou e cobra: R$ 440, baixa dos insumos e pendência', async () => {
    const { service, captured } = setup(exam());

    await service.registerCollection(ctx, EXAM_ID, COLLECTION);

    expect(captured.data).toMatchObject({ status: 'collected', material: 'Sangue', laborCents: 8000 });
    expect(captured.data?.expectedResultAt?.toISOString()).toBe('2026-10-06T10:00:00.000Z');
    expect(captured.finalized?.data).toEqual({ totalCents: 44000 });
    expect(eventNames(captured.finalized)).toEqual(['exam.collected', 'exam.charged']);

    const charged = captured.finalized?.events?.[1] as DomainEvent<{ totalCostCents: number; performedAt: string }>;
    expect(charged.payload.totalCostCents).toBe(44000);
    expect(charged.payload.performedAt).toBe(COLLECTION.collectedAt);
    expect(charged.idempotencyKey).toBe(deriveEventIdempotencyKey('exam.charged', EXAM_ID));
  });

  it('caso 2 — vet coletou e o cliente pagou o laboratório: R$ 150', async () => {
    const { service, captured } = setup(exam({ paidDirectlyByClient: true }));

    await service.registerCollection(ctx, EXAM_ID, COLLECTION);

    expect(captured.finalized?.data).toEqual({ totalCents: 15000 });
    expect(eventNames(captured.finalized)).toEqual(['exam.collected', 'exam.charged']);
  });

  it('coleta sem insumo não publica baixa', async () => {
    const { service, captured } = setup(exam());

    await service.registerCollection(ctx, EXAM_ID, { ...COLLECTION, items: [] });

    expect(eventNames(captured.finalized)).toEqual(['exam.charged']);
  });

  it('tipo sem prazo: sem data prevista', async () => {
    const { service, captured } = setup(exam(), examType({ expectedTurnaroundDays: null }));
    await service.registerCollection(ctx, EXAM_ID, COLLECTION);
    expect(captured.data?.expectedResultAt).toBeNull();
  });

  it('rascunho precisa ser emitido antes', async () => {
    const { service } = setup(exam({ status: 'draft' }));
    await expect(service.registerCollection(ctx, EXAM_ID, COLLECTION)).rejects.toThrow(/Emita o pedido/);
  });

  it('outra requisição avançou o pedido no meio do caminho → 409', async () => {
    const { service, advance } = setup(exam());
    advance.mockResolvedValueOnce(null);
    await expect(service.registerCollection(ctx, EXAM_ID, COLLECTION)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('ExamService.sendToAnalysis', () => {
  it('caso 3 — não coletou e o cliente pagou o laboratório: fecha a cobrança em 0, sem evento', async () => {
    const { service, captured } = setup(exam({ paidDirectlyByClient: true }));

    await service.sendToAnalysis(ctx, EXAM_ID);

    expect(captured.data?.status).toBe('in_analysis');
    expect(captured.data?.chargedAt).toBeInstanceOf(Date);
    expect(captured.finalized?.data).toEqual({ totalCents: 0 });
    expect(eventNames(captured.finalized)).toEqual([]);
  });

  it('caso 4 — não coletou e cobra: só o procedimento, com a data do envio', async () => {
    const { service, captured } = setup(exam());

    await service.sendToAnalysis(ctx, EXAM_ID);

    expect(captured.finalized?.data).toEqual({ totalCents: 30000 });
    expect(eventNames(captured.finalized)).toEqual(['exam.charged']);
    const charged = captured.finalized?.events?.[0] as DomainEvent<{ performedAt: string }>;
    expect(charged.payload.performedAt).toBe(captured.data?.chargedAt?.toISOString());
  });

  it('já coletado: só muda o status — a cobrança já fechou', async () => {
    const { service, captured } = setup(exam({ status: 'collected', chargedAt: '2026-10-01T10:00:00.000Z' }));

    await service.sendToAnalysis(ctx, EXAM_ID);

    expect(captured.data).toEqual({ status: 'in_analysis' });
    expect(captured.finalized).toBeUndefined();
  });

  it('já em análise é 409', async () => {
    const { service } = setup(exam({ status: 'in_analysis' }));
    await expect(service.sendToAnalysis(ctx, EXAM_ID)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('ExamService.attachResult (RF-EXM-005)', () => {
  const URL = 'https://arquivos.exemplo/laudo.pdf';

  it('direto de solicitado: anexa e fecha a cobrança', async () => {
    const { service, captured } = setup(exam());

    await service.attachResult(ctx, EXAM_ID, URL);

    expect(captured.data).toMatchObject({ status: 'result_available', resultFileUrl: URL });
    expect(captured.finalized?.data).toEqual({ totalCents: 30000 });
  });

  it('de coletado (pulando a análise) e reanexando: não mexe na cobrança', async () => {
    for (const status of ['collected', 'result_available'] as const) {
      const { service, captured, advance } = setup(exam({ status, chargedAt: '2026-10-01T10:00:00.000Z' }));
      await service.attachResult(ctx, EXAM_ID, URL);
      expect(advance.mock.calls[0]?.[2]).toEqual([status]);
      expect(captured.finalized).toBeUndefined();
    }
  });

  it('rascunho não recebe laudo', async () => {
    const { service } = setup(exam({ status: 'draft' }));
    await expect(service.attachResult(ctx, EXAM_ID, URL)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('ExamService.softDelete', () => {
  it('pedido com pendência publica exam.deleted', async () => {
    const charged = exam({ status: 'collected', chargedAt: '2026-10-01T10:00:00.000Z', totalCents: 44000 });
    const { service, repo } = setup(charged);

    await service.softDelete(ctx, EXAM_ID);

    expect(repo.softDelete).toHaveBeenCalledWith(
      ctx,
      EXAM_ID,
      { status: 'collected', charged: true },
      expect.objectContaining({ name: 'exam.deleted' }),
    );
  });

  it('cobrança fechada em 0 (caso 3) some em silêncio', async () => {
    const { service, repo } = setup(exam({ status: 'in_analysis', chargedAt: '2026-10-01T10:00:00.000Z' }));
    await service.softDelete(ctx, EXAM_ID);
    expect(repo.softDelete).toHaveBeenCalledWith(ctx, EXAM_ID, { status: 'in_analysis', charged: true }, null);
  });

  it('pedido inexistente é 404', async () => {
    const { service, repo } = setup(exam());
    vi.mocked(repo.findById).mockResolvedValueOnce(null);
    await expect(service.softDelete(ctx, EXAM_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});
