import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OsrmRouteAdapter } from './osrm-route-adapter';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const ORIGIN = { latitude: -16.5, longitude: -49.0 };
const DESTINATION = { latitude: -17.88, longitude: -51.71 };

describe('OsrmRouteAdapter.route', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retorna km/minutos crus (sem arredondar) quando a API acha a rota', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ code: 'Ok', routes: [{ distance: 12345.6, duration: 678.9 }] }),
    );
    const adapter = new OsrmRouteAdapter();

    const result = await adapter.route(ORIGIN, DESTINATION);

    // toBeCloseTo: 12345.6 / 1000 não cai exato em ponto flutuante (IEEE754).
    expect(result?.distanceKm).toBeCloseTo(12.3456, 6);
    expect(result?.durationMinutes).toBeCloseTo(678.9 / 60, 6);
  });

  it('chama a URL do OSRM com lon,lat (ordem invertida em relação a GeoPoint) e overview=false', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'Ok', routes: [{ distance: 1000, duration: 60 }] }));
    const adapter = new OsrmRouteAdapter();

    await adapter.route(ORIGIN, DESTINATION);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe(
      `https://router.project-osrm.org/route/v1/driving/${ORIGIN.longitude},${ORIGIN.latitude};${DESTINATION.longitude},${DESTINATION.latitude}?overview=false`,
    );
  });

  it('retorna null (sem lançar) quando não há rota de carro (code != Ok)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'NoRoute' }));
    const adapter = new OsrmRouteAdapter();

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando routes vem vazio mesmo com code Ok', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'Ok', routes: [] }));
    const adapter = new OsrmRouteAdapter();

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando a API responde com erro HTTP', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 503));
    const adapter = new OsrmRouteAdapter();

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando o fetch rejeita — erro de rede/timeout', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'));
    const adapter = new OsrmRouteAdapter();

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });
});
