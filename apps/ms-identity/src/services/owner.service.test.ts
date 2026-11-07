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
  cpf: '123.456.789-00',
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
  it('verifica o limite do plano com a contagem atual antes de criar', async () => {
    const countActive = vi.fn().mockResolvedValue(29);
    const assertOwnerLimit = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(owner);
    const service = new OwnerService(fakeRepo({ countActive, create }), fakePlans({ assertOwnerLimit }));

    await service.create(ctx(), { fullName: 'Novo Proprietário' });

    expect(countActive).toHaveBeenCalledWith(ctx());
    expect(assertOwnerLimit).toHaveBeenCalledWith(ctx(), 29);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propaga o erro de limite de plano e não chega a criar', async () => {
    const create = vi.fn().mockResolvedValue(owner);
    const assertOwnerLimit = vi.fn().mockRejectedValue(new Error('Plano Básico permite até 30 proprietários'));
    const service = new OwnerService(fakeRepo({ create }), fakePlans({ assertOwnerLimit }));

    await expect(service.create(ctx(), { fullName: 'Proprietário 31' })).rejects.toThrow(/30 proprietários/);
    expect(create).not.toHaveBeenCalled();
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
