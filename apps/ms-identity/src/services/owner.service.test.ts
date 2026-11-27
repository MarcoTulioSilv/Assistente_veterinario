import { describe, it, expect, vi } from 'vitest';
import { OwnerService } from './owner.service';
import type { OwnerRepository } from '../repositories/owner.repository';
import type { PlanService } from './plan.service';
import type { RequestContext, Owner } from '@quironequine/shared-types';

const ctx = (plan: 'basic' | 'plus' = 'basic'): RequestContext => ({
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan,
  traceId: 'test-trace',
});

const owner: Owner = {
  id: '33333333-3333-3333-3333-333333333333',
  fullName: 'Proprietário Teste',
  cpfCnpj: '529.982.247-25',
  cpf: '529.982.247-25',
  email: 'owner@example.com',
  phone: '(64) 99999-0000',
  phone2: null,
  address: null,
  city: 'Jataí',
  state: 'GO',
  status: 'active',
  notifyBlocked: false,
  createdAt: new Date().toISOString(),
};

function fakeRepo(overrides: Partial<OwnerRepository> = {}): OwnerRepository {
  return {
    list: vi.fn().mockResolvedValue({ data: [owner], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    findById: vi.fn().mockResolvedValue(owner),
    countActive: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(owner),
    update: vi.fn().mockResolvedValue(owner),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as OwnerRepository;
}

function fakePlans(overrides: Partial<PlanService> = {}): PlanService {
  return {
    assertOwnerLimit: vi.fn().mockResolvedValue(undefined),
    assertUserLimit: vi.fn().mockResolvedValue(undefined),
    isPlus: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as PlanService;
}

describe('OwnerService.list / findById', () => {
  it('delega list() pro repositório', async () => {
    const repo = fakeRepo();
    const service = new OwnerService(repo, fakePlans());

    const result = await service.list(ctx(), { page: 1, limit: 20, status: 'active' });

    expect(result.data).toEqual([owner]);
    expect(repo.list).toHaveBeenCalledWith(ctx(), { page: 1, limit: 20, status: 'active' });
  });

  it('delega findById() pro repositório', async () => {
    const repo = fakeRepo();
    const service = new OwnerService(repo, fakePlans());

    await expect(service.findById(ctx(), owner.id)).resolves.toEqual(owner);
  });
});

describe('OwnerService.create', () => {
  /** Repositório falso que roda a checagem do limite como o real: sob a trava, antes de gravar. */
  function createRunningGuard(activeCount: number) {
    return vi.fn(async (_ctx: unknown, _data: unknown, withinLimit?: (n: number) => Promise<void> | void) => {
      await withinLimit?.(activeCount);
      return owner;
    });
  }

  it('passa a checagem do limite do plano para o repositório fazer na transação da gravação (B-01)', async () => {
    const assertOwnerLimit = vi.fn().mockResolvedValue(undefined);
    const create = createRunningGuard(29);
    const service = new OwnerService(fakeRepo({ create }), fakePlans({ assertOwnerLimit }));

    await service.create(ctx(), { fullName: 'Novo Proprietário' });

    expect(assertOwnerLimit).toHaveBeenCalledWith(ctx(), 29);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propaga o erro de limite de plano', async () => {
    const assertOwnerLimit = vi.fn().mockRejectedValue(new Error('Plano Básico permite até 30 proprietários'));
    const service = new OwnerService(fakeRepo({ create: createRunningGuard(30) }), fakePlans({ assertOwnerLimit }));

    await expect(service.create(ctx(), { fullName: 'Proprietário 31' })).rejects.toThrow(/30 proprietários/);
  });
});

describe('OwnerService.update', () => {
  it('rejeita quando o proprietário não existe', async () => {
    const service = new OwnerService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakePlans());

    await expect(service.update(ctx(), 'id-inexistente', { fullName: 'X' })).rejects.toThrow(/não encontrado/);
  });

  it('atualiza quando o proprietário existe', async () => {
    const update = vi.fn().mockResolvedValue({ ...owner, fullName: 'Nome Atualizado' });
    const service = new OwnerService(fakeRepo({ update }), fakePlans());

    const result = await service.update(ctx(), owner.id, { fullName: 'Nome Atualizado' });

    expect(update).toHaveBeenCalledWith(ctx(), owner.id, { fullName: 'Nome Atualizado' });
    expect(result.fullName).toBe('Nome Atualizado');
  });
});

describe('OwnerService: CPF ou CNPJ', () => {
  it('grava o CNPJ alfanumérico no formato canônico', async () => {
    const create = vi.fn().mockResolvedValue(owner);
    const service = new OwnerService(fakeRepo({ create }), fakePlans());

    await service.create(ctx(), { fullName: 'Haras', cpfCnpj: '12abc34501de35' });

    expect(create).toHaveBeenCalledWith(ctx(), { fullName: 'Haras', cpfCnpj: '12.ABC.345/01DE-35' }, expect.any(Function));
  });

  it('aceita o campo cpf antigo durante a transição e grava como cpfCnpj', async () => {
    const create = vi.fn().mockResolvedValue(owner);
    const service = new OwnerService(fakeRepo({ create }), fakePlans());

    await service.create(ctx(), { fullName: 'Maria', cpf: '52998224725' });

    expect(create).toHaveBeenCalledWith(ctx(), { fullName: 'Maria', cpfCnpj: '529.982.247-25' }, expect.any(Function));
  });

  it('se vierem os dois, vale cpfCnpj', async () => {
    const create = vi.fn().mockResolvedValue(owner);
    const service = new OwnerService(fakeRepo({ create }), fakePlans());

    await service.create(ctx(), { fullName: 'Haras', cpf: '529.982.247-25', cpfCnpj: '11.222.333/0001-81' });

    expect(create).toHaveBeenCalledWith(ctx(), { fullName: 'Haras', cpfCnpj: '11.222.333/0001-81' }, expect.any(Function));
  });

  it('documento inválido é 422 em cpfCnpj, sem gravar', async () => {
    const create = vi.fn();
    const service = new OwnerService(fakeRepo({ create }), fakePlans());

    await expect(service.create(ctx(), { fullName: 'X', cpfCnpj: '123.456.789-00' })).rejects.toMatchObject({
      statusCode: 422,
      details: [expect.objectContaining({ field: 'cpfCnpj' })],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('update também valida e normaliza', async () => {
    const update = vi.fn().mockResolvedValue(owner);
    const service = new OwnerService(fakeRepo({ update }), fakePlans());

    await service.update(ctx(), owner.id, { cpf: '11222333000181' });
    expect(update).toHaveBeenCalledWith(ctx(), owner.id, { cpfCnpj: '11.222.333/0001-81' });

    await expect(service.update(ctx(), owner.id, { cpfCnpj: '11.222.333/0001-82' })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('OwnerService.softDelete', () => {
  it('rejeita quando o proprietário não existe', async () => {
    const service = new OwnerService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakePlans());

    await expect(service.softDelete(ctx(), 'id-inexistente')).rejects.toThrow(/não encontrado/);
  });

  it('remove (soft delete) quando o proprietário existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new OwnerService(fakeRepo({ softDelete }), fakePlans());

    await service.softDelete(ctx(), owner.id);

    expect(softDelete).toHaveBeenCalledWith(ctx(), owner.id);
  });
});
