import { describe, it, expect, vi } from 'vitest';
import type { RequestContext, ExamType } from '@quironequine/shared-types';
import type { ExamTypeRepository } from '../repositories/exam-type.repository';
import { ExamTypeService } from './exam-type.service';
import { validateProtocolData } from './exam-protocol';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'plus',
  traceId: 'trace-teste',
};

const TYPE_ID = '44444444-4444-4444-4444-444444444444';

const TYPE: ExamType = {
  id: TYPE_ID,
  name: 'Mormo',
  defaultPriceCents: 0,
  expectedTurnaroundDays: null,
  protocolFields: [],
  createdAt: '2026-10-01T12:00:00.000Z',
};

function fakeRepo(overrides: Partial<ExamTypeRepository> = {}): ExamTypeRepository {
  return {
    list: vi.fn(),
    findById: vi.fn().mockResolvedValue(TYPE),
    create: vi.fn().mockResolvedValue(TYPE),
    update: vi.fn().mockResolvedValue(TYPE),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ExamTypeRepository;
}

describe('ExamTypeService', () => {
  it('editar ou excluir tipo inexistente é 404', async () => {
    const repo = fakeRepo({ findById: vi.fn().mockResolvedValue(null) });
    const service = new ExamTypeService(repo);

    await expect(service.update(ctx, TYPE_ID, { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.softDelete(ctx, TYPE_ID)).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('exclusão é soft delete', async () => {
    const repo = fakeRepo();
    await new ExamTypeService(repo).softDelete(ctx, TYPE_ID);
    expect(repo.softDelete).toHaveBeenCalledWith(ctx, TYPE_ID);
  });
});

describe('validateProtocolData (RF-EXM-002)', () => {
  const fields = [
    { key: 'laboratorio', label: 'Laboratório', type: 'text' as const, required: true },
    { key: 'animais', label: 'Nº de animais', type: 'number' as const, required: false },
    { key: 'data_gta', label: 'Data da GTA', type: 'date' as const, required: false },
    { key: 'finalidade', label: 'Finalidade', type: 'select' as const, required: false, options: ['Trânsito', 'Rotina'] },
  ];

  it('aceita valores válidos e descarta os em branco', () => {
    expect(
      validateProtocolData(
        fields,
        { laboratorio: 'LANAGRO', animais: 3, data_gta: '2026-10-01', finalidade: 'Rotina', },
        { requireMandatory: true },
      ),
    ).toEqual({ laboratorio: 'LANAGRO', animais: 3, data_gta: '2026-10-01', finalidade: 'Rotina' });
    expect(validateProtocolData(fields, { animais: null }, { requireMandatory: false })).toEqual({});
  });

  it('obrigatório só é cobrado com requireMandatory', () => {
    expect(() => validateProtocolData(fields, {}, { requireMandatory: false })).not.toThrow();
    expect(() => validateProtocolData(fields, {}, { requireMandatory: true })).toThrow(/protocolo inválidos/);
  });

  it('rejeita chave desconhecida, tipo errado e opção fora da lista', () => {
    for (const data of [{ outro: 1 }, { animais: 'três' }, { data_gta: 'ontem' }, { finalidade: 'Festa' }]) {
      expect(() => validateProtocolData(fields, data, { requireMandatory: false })).toThrow(/protocolo inválidos/);
    }
  });
});
