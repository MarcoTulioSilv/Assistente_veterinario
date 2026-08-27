import { describe, it, expect, vi } from 'vitest';
import { PropertyService } from './property.service';
import type { PropertyRepository } from '../repositories/property.repository';
import type { GeoService } from './geo.service';
import type { PlanService } from './plan.service';
import type { RequestContext, Property } from '@vetequine/shared-types';

const ctx: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'admin',
  plan: 'basic',
  traceId: 'test-trace',
};

const property: Property = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Fazenda Teste',
  address: 'Rodovia GO-184, km 12',
  city: 'Jataí',
  state: 'GO',
  zipCode: null,
  latitude: -17.88,
  longitude: -51.71,
  status: 'active',
  createdAt: new Date().toISOString(),
};

function fakeRepo(overrides: Partial<PropertyRepository> = {}): PropertyRepository {
  return {
    list: vi.fn().mockResolvedValue({ data: [property], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    findById: vi.fn().mockResolvedValue(property),
    countActive: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(property),
    update: vi.fn().mockResolvedValue(property),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PropertyRepository;
}

function fakeGeo(coordinates: { latitude: number; longitude: number } | null = null): GeoService {
  return { resolveCoordinates: vi.fn().mockResolvedValue(coordinates) } as unknown as GeoService;
}

function fakePlans(overrides: Partial<PlanService> = {}): PlanService {
  return {
    assertOwnerLimit: vi.fn().mockResolvedValue(undefined),
    assertPropertyLimit: vi.fn().mockResolvedValue(undefined),
    assertUserLimit: vi.fn().mockResolvedValue(undefined),
    isPlus: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as PlanService;
}

describe('PropertyService.create', () => {
  it('verifica o limite do plano com a contagem atual antes de criar', async () => {
    const countActive = vi.fn().mockResolvedValue(29);
    const assertPropertyLimit = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ countActive, create }), fakeGeo(), fakePlans({ assertPropertyLimit }));

    await service.create(ctx, { name: 'Nova Fazenda' });

    expect(countActive).toHaveBeenCalledWith(ctx);
    expect(assertPropertyLimit).toHaveBeenCalledWith(ctx, 29);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propaga o erro de limite de plano e não chega a criar nem a geocodificar', async () => {
    const create = vi.fn().mockResolvedValue(property);
    const geo = fakeGeo();
    const assertPropertyLimit = vi.fn().mockRejectedValue(new Error('Plano Básico permite até 30 propriedades'));
    const service = new PropertyService(fakeRepo({ create }), geo, fakePlans({ assertPropertyLimit }));

    await expect(service.create(ctx, { name: 'Fazenda 31' })).rejects.toThrow(/30 propriedades/);
    expect(create).not.toHaveBeenCalled();
    expect(geo.resolveCoordinates).not.toHaveBeenCalled();
  });

  it('resolve coordenadas via GeoService e repassa pro repositório', async () => {
    const geo = fakeGeo({ latitude: -17.88, longitude: -51.71 });
    const create = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ create }), geo, fakePlans());

    const input = { name: 'Fazenda Teste', address: 'Rodovia GO-184', city: 'Jataí', state: 'GO' };
    await service.create(ctx, input);

    expect(geo.resolveCoordinates).toHaveBeenCalledWith(input);
    expect(create).toHaveBeenCalledWith(ctx, input, { latitude: -17.88, longitude: -51.71 });
  });

  it('cria com coordenadas null quando o GeoService não resolve nada (não bloqueia o cadastro)', async () => {
    const create = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ create }), fakeGeo(null), fakePlans());

    await service.create(ctx, { name: 'Só o nome' });

    expect(create).toHaveBeenCalledWith(ctx, { name: 'Só o nome' }, null);
  });
});

describe('PropertyService.update', () => {
  it('rejeita quando a propriedade não existe', async () => {
    const service = new PropertyService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakeGeo(), fakePlans());

    await expect(service.update(ctx, 'id-inexistente', { name: 'X' })).rejects.toThrow(/não encontrada/);
  });

  it('atualiza quando a propriedade existe', async () => {
    const update = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ update }), fakeGeo(), fakePlans());

    await service.update(ctx, property.id, { name: 'Novo nome' });

    expect(update).toHaveBeenCalledWith(ctx, property.id, { name: 'Novo nome' }, null);
  });
});

describe('PropertyService.softDelete', () => {
  it('rejeita quando a propriedade não existe', async () => {
    const service = new PropertyService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakeGeo(), fakePlans());

    await expect(service.softDelete(ctx, 'id-inexistente')).rejects.toThrow(/não encontrada/);
  });

  it('remove (soft delete) quando a propriedade existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new PropertyService(fakeRepo({ softDelete }), fakeGeo(), fakePlans());

    await service.softDelete(ctx, property.id);

    expect(softDelete).toHaveBeenCalledWith(ctx, property.id);
  });
});
