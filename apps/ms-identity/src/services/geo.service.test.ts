import { describe, it, expect, vi } from 'vitest';
import { GeoService } from './geo.service';
import type { MapsAdapter } from '../adapters/maps-adapter';

function fakeAdapter(result: { latitude: number; longitude: number } | null = null): MapsAdapter {
  return { geocode: vi.fn().mockResolvedValue(result) };
}

describe('GeoService.resolveCoordinates', () => {
  it('usa lat/lng informados direto, sem chamar o adapter', async () => {
    const adapter = fakeAdapter();
    const geo = new GeoService(adapter);

    const result = await geo.resolveCoordinates({ latitude: -17.88, longitude: -51.71 });

    expect(result).toEqual({ latitude: -17.88, longitude: -51.71 });
    expect(adapter.geocode).not.toHaveBeenCalled();
  });

  it('retorna null sem chamar o adapter quando não há endereço suficiente', async () => {
    const adapter = fakeAdapter();
    const geo = new GeoService(adapter);

    await expect(geo.resolveCoordinates({ address: 'Rua X' })).resolves.toBeNull();
    expect(adapter.geocode).not.toHaveBeenCalled();
  });

  it('chama o adapter quando há endereço completo e nenhuma coordenada', async () => {
    const adapter = fakeAdapter({ latitude: -17.88, longitude: -51.71 });
    const geo = new GeoService(adapter);

    const result = await geo.resolveCoordinates({ address: 'Rua X, 100', city: 'Jataí', state: 'GO' });

    expect(result).toEqual({ latitude: -17.88, longitude: -51.71 });
    expect(adapter.geocode).toHaveBeenCalledTimes(1);
  });

  it('adapter retornando null não lança erro, só devolve null', async () => {
    const adapter = fakeAdapter(null);
    const geo = new GeoService(adapter);

    await expect(
      geo.resolveCoordinates({ address: 'Rua X', city: 'Jataí', state: 'GO' }),
    ).resolves.toBeNull();
  });

  it('cacheia por endereço — segunda chamada com o mesmo endereço não chama o adapter de novo', async () => {
    const adapter = fakeAdapter({ latitude: -17.88, longitude: -51.71 });
    const geo = new GeoService(adapter);
    const input = { address: 'Rua X, 100', city: 'Jataí', state: 'GO' };

    await geo.resolveCoordinates(input);
    await geo.resolveCoordinates(input);

    expect(adapter.geocode).toHaveBeenCalledTimes(1);
  });
});
