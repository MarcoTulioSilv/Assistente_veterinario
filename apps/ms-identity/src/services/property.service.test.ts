import { describe, it, expect, vi } from 'vitest';
import { PropertyService } from './property.service';
import type { PropertyRepository } from '../repositories/property.repository';
import type { GeoService } from './geo.service';
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
    create: vi.fn().mockResolvedValue(property),
    update: vi.fn().mockResolvedValue(property),
    softDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PropertyRepository;
}

function fakeGeo(coordinates: { latitude: number; longitude: number } | null = null): GeoService {
  return { resolveCoordinates: vi.fn().mockResolvedValue(coordinates) } as unknown as GeoService;
}

describe('PropertyService.create', () => {
  it('resolve coordenadas via GeoService e repassa pro repositório', async () => {
    const geo = fakeGeo({ latitude: -17.88, longitude: -51.71 });
    const create = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ create }), geo);

    const input = { name: 'Fazenda Teste', address: 'Rodovia GO-184', city: 'Jataí', state: 'GO' };
    await service.create(ctx, input);

    expect(geo.resolveCoordinates).toHaveBeenCalledWith(input);
    expect(create).toHaveBeenCalledWith(ctx, input, { latitude: -17.88, longitude: -51.71 });
  });

  it('cria com coordenadas null quando o GeoService não resolve nada (não bloqueia o cadastro)', async () => {
    const create = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ create }), fakeGeo(null));

    await service.create(ctx, { name: 'Só o nome' });

    expect(create).toHaveBeenCalledWith(ctx, { name: 'Só o nome' }, null);
  });
});

describe('PropertyService.update', () => {
  it('rejeita quando a propriedade não existe', async () => {
    const service = new PropertyService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakeGeo());

    await expect(service.update(ctx, 'id-inexistente', { name: 'X' })).rejects.toThrow(/não encontrada/);
  });

  it('atualiza quando a propriedade existe', async () => {
    const update = vi.fn().mockResolvedValue(property);
    const service = new PropertyService(fakeRepo({ update }), fakeGeo());

    await service.update(ctx, property.id, { name: 'Novo nome' });

    expect(update).toHaveBeenCalledWith(ctx, property.id, { name: 'Novo nome' }, null);
  });
});

describe('PropertyService.softDelete', () => {
  it('rejeita quando a propriedade não existe', async () => {
    const service = new PropertyService(fakeRepo({ findById: vi.fn().mockResolvedValue(null) }), fakeGeo());

    await expect(service.softDelete(ctx, 'id-inexistente')).rejects.toThrow(/não encontrada/);
  });

  it('remove (soft delete) quando a propriedade existe', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const service = new PropertyService(fakeRepo({ softDelete }), fakeGeo());

    await service.softDelete(ctx, property.id);

    expect(softDelete).toHaveBeenCalledWith(ctx, property.id);
  });
});
