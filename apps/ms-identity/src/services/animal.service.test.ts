import { describe, it, expect, vi } from 'vitest';
import { AnimalService } from './animal.service';
import type { AnimalRepository } from '../repositories/animal.repository';
import type { RequestContext, Animal } from '@quironequine/shared-types';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

const animal: Animal = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Trovão',
  species: 'equine',
  sex: 'male',
  breed: null,
  coat: null,
  birthDate: null,
  castrated: false,
  photoUrl: null,
  sketchUrl: null,
  status: 'active',
  propertyId: '44444444-4444-4444-4444-444444444444',
  ownerId: '55555555-5555-5555-5555-555555555555',
  createdAt: new Date().toISOString(),
};

function fakeRepo(overrides: Partial<AnimalRepository> = {}): AnimalRepository {
  return {
    list: vi.fn().mockResolvedValue({ data: [animal], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    findById: vi.fn().mockResolvedValue(animal),
    create: vi.fn().mockResolvedValue(animal),
    update: vi.fn().mockResolvedValue(animal),
    softDelete: vi.fn().mockResolvedValue(undefined),
    transfer: vi.fn().mockResolvedValue(animal),
    ...overrides,
  } as unknown as AnimalRepository;
}

describe('AnimalService.create', () => {
  it('não checa nenhum limite de plano — delega direto pro repositório', async () => {
    const create = vi.fn().mockResolvedValue(animal);
    const service = new AnimalService(fakeRepo({ create }));

    const input = { name: 'Trovão' };
    await service.create(ctx, input);

    expect(create).toHaveBeenCalledWith(ctx, input);
  });
});

describe('AnimalService.update', () => {
  it('rejeita quando o animal não existe', async () => {
    const service = new AnimalService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.update(ctx, 'id-inexistente', { name: 'X' })).rejects.toThrow(/não encontrado/);
  });

  it('atualiza quando o animal existe', async () => {
    const update = vi.fn().mockResolvedValue(animal);
    const service = new AnimalService(fakeRepo({ update }));

    await service.update(ctx, animal.id, { name: 'Novo nome' });

    expect(update).toHaveBeenCalledWith(ctx, animal.id, { name: 'Novo nome' });
  });
});

describe('AnimalService.softDelete', () => {
  it('rejeita quando o animal não existe', async () => {
    const service = new AnimalService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.softDelete(ctx, 'id-inexistente')).rejects.toThrow(/não encontrado/);
  });

  it('remove (soft delete) quando o animal existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new AnimalService(fakeRepo({ softDelete }));

    await service.softDelete(ctx, animal.id);

    expect(softDelete).toHaveBeenCalledWith(ctx, animal.id);
  });
});

describe('AnimalService.transfer', () => {
  it('rejeita quando o animal não existe', async () => {
    const service = new AnimalService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }));

    await expect(service.transfer(ctx, 'id-inexistente', 'outra-propriedade')).rejects.toThrow(/não encontrado/);
  });

  it('delega a transferência com os parâmetros certos quando o animal existe', async () => {
    const transfer = vi.fn().mockResolvedValue(animal);
    const service = new AnimalService(fakeRepo({ transfer }));

    await service.transfer(ctx, animal.id, 'nova-propriedade', 'observação');

    expect(transfer).toHaveBeenCalledWith(ctx, animal.id, 'nova-propriedade', 'observação');
  });
});
