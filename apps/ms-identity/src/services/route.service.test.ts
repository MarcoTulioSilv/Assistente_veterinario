import { describe, it, expect, vi } from 'vitest';
import type { RouteAdapter } from '../adapters/route-adapter';
import { MockRouteAdapter } from '../adapters/route-adapter';
import { RouteService } from './route.service';

const BASE = { latitude: -17.8815, longitude: -51.7141 }; // Jataí
const FAZENDA = { latitude: -17.7923, longitude: -50.9192 }; // Rio Verde

function adapterReturning(value: Awaited<ReturnType<RouteAdapter['route']>>): RouteAdapter & { route: ReturnType<typeof vi.fn> } {
  return { route: vi.fn().mockResolvedValue(value) };
}

describe('RouteService.distance', () => {
  it('arredonda o km em 0,1 e o tempo em minutos', async () => {
    const service = new RouteService(adapterReturning({ distanceKm: 92.4567, durationMinutes: 71.6 }));

    await expect(service.distance(BASE, FAZENDA)).resolves.toEqual({ distanceKm: 92.5, durationMinutes: 72 });
  });

  it('a mesma rota (até ~1 m de diferença) não chama a API de novo', async () => {
    const adapter = adapterReturning({ distanceKm: 92, durationMinutes: 70 });
    const service = new RouteService(adapter);

    await service.distance(BASE, FAZENDA);
    await service.distance(BASE, { latitude: FAZENDA.latitude + 0.000001, longitude: FAZENDA.longitude });

    expect(adapter.route).toHaveBeenCalledTimes(1);
  });

  it('ida e volta são rotas diferentes (mão única, desvio) — não compartilham cache', async () => {
    const adapter = adapterReturning({ distanceKm: 92, durationMinutes: 70 });
    const service = new RouteService(adapter);

    await service.distance(BASE, FAZENDA);
    await service.distance(FAZENDA, BASE);

    expect(adapter.route).toHaveBeenCalledTimes(2);
  });

  it('mesmo ponto: 0 km, sem gastar chamada da API', async () => {
    const adapter = adapterReturning({ distanceKm: 1, durationMinutes: 1 });

    await expect(new RouteService(adapter).distance(BASE, BASE)).resolves.toEqual({ distanceKm: 0, durationMinutes: 0 });
    expect(adapter.route).not.toHaveBeenCalled();
  });

  it('rota indisponível devolve null — e tenta de novo na próxima vez (falha não fica no cache)', async () => {
    const adapter = adapterReturning(null);
    adapter.route.mockResolvedValueOnce(null).mockResolvedValueOnce({ distanceKm: 92, durationMinutes: 70 });
    const service = new RouteService(adapter);

    await expect(service.distance(BASE, FAZENDA)).resolves.toBeNull();
    await expect(service.distance(BASE, FAZENDA)).resolves.toEqual({ distanceKm: 92, durationMinutes: 70 });
  });

  it('coordenada inválida é 422, sem chamar a API', async () => {
    const adapter = adapterReturning({ distanceKm: 1, durationMinutes: 1 });
    const service = new RouteService(adapter);

    for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: Number.NaN, longitude: 0 }]) {
      await expect(service.distance(bad, FAZENDA)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(adapter.route).not.toHaveBeenCalled();
  });

  it('o cache tem teto: as rotas mais antigas saem primeiro', async () => {
    const adapter = adapterReturning({ distanceKm: 10, durationMinutes: 10 });
    const service = new RouteService(adapter);
    const destino = (i: number) => ({ latitude: -17, longitude: -51 + i * 0.001 });

    for (let i = 0; i < 1001; i++) await service.distance(BASE, destino(i));
    adapter.route.mockClear();

    await service.distance(BASE, destino(1000)); // ainda no cache
    await service.distance(BASE, destino(0)); // o mais antigo saiu
    expect(adapter.route).toHaveBeenCalledTimes(1);
  });

  it('com o adapter provisório, a rota fica indisponível (tela pede o km à mão)', async () => {
    await expect(new RouteService(new MockRouteAdapter()).distance(BASE, FAZENDA)).resolves.toBeNull();
  });
});
