import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleRouteAdapter } from './google-route-adapter';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const ORIGIN = { latitude: -16.5, longitude: -49.0 };
const DESTINATION = { latitude: -17.88, longitude: -51.71 };

describe('GoogleRouteAdapter.route', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retorna km/minutos crus (sem arredondar) quando a API acha a rota', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ routes: [{ distanceMeters: 12345, duration: '679s' }] }),
    );
    const adapter = new GoogleRouteAdapter('fake-key');

    const result = await adapter.route(ORIGIN, DESTINATION);

    expect(result).toEqual({ distanceKm: 12.345, durationMinutes: 679 / 60 });
  });

  it('chama o computeRoutes com os headers e o corpo corretos', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ routes: [{ distanceMeters: 1000, duration: '60s' }] }),
    );
    const adapter = new GoogleRouteAdapter('minha-chave');

    await adapter.route(ORIGIN, DESTINATION);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('minha-chave');
    expect(headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      origin: { latLng: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude } },
      destination: { latLng: { latitude: DESTINATION.latitude, longitude: DESTINATION.longitude } },
      travelMode: 'DRIVE',
    });
  });

  it('retorna null (sem lançar) quando não há rota de carro (routes vazio)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ routes: [] }));
    const adapter = new GoogleRouteAdapter('fake-key');

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando a API responde com erro HTTP', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 403));
    const adapter = new GoogleRouteAdapter('chave-invalida');

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando o fetch rejeita — erro de rede/timeout', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'));
    const adapter = new GoogleRouteAdapter('fake-key');

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });

  it('retorna null sem chamar a API quando a chave está ausente', async () => {
    const adapter = new GoogleRouteAdapter('');

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retorna null quando duration vem em formato inesperado', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ routes: [{ distanceMeters: 1000, duration: 'abc' }] }),
    );
    const adapter = new GoogleRouteAdapter('fake-key');

    await expect(adapter.route(ORIGIN, DESTINATION)).resolves.toBeNull();
  });
});
