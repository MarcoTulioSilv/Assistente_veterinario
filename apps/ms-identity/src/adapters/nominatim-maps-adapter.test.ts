import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NominatimMapsAdapter } from './nominatim-maps-adapter';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('NominatimMapsAdapter.geocode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retorna coordenadas quando a API acha o endereço', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '-17.88', lon: '-51.71' }]));
    const adapter = new NominatimMapsAdapter();

    const result = await adapter.geocode('Rodovia GO-184, Jataí - GO');

    expect(result).toEqual({ latitude: -17.88, longitude: -51.71 });
  });

  it('chama a URL correta com format=json, q e limit=1, e um User-Agent identificando a aplicação', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '-17.88', lon: '-51.71' }]));
    const adapter = new NominatimMapsAdapter();

    await adapter.geocode('Rua X, Jataí - GO');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit];
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(calledUrl.searchParams.get('format')).toBe('json');
    expect(calledUrl.searchParams.get('q')).toBe('Rua X, Jataí - GO');
    expect(calledUrl.searchParams.get('limit')).toBe('1');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^QuironEquine\/1\.0/);
  });

  it('retorna null (sem lançar) quando o endereço não é encontrado', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    const adapter = new NominatimMapsAdapter();

    await expect(adapter.geocode('endereço que não existe')).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando a API responde com erro HTTP', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([], false, 429));
    const adapter = new NominatimMapsAdapter();

    await expect(adapter.geocode('qualquer endereço')).resolves.toBeNull();
  });

  it('retorna null (sem lançar) quando o fetch rejeita — erro de rede/timeout', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'));
    const adapter = new NominatimMapsAdapter();

    await expect(adapter.geocode('qualquer endereço')).resolves.toBeNull();
  });

  it('retorna null quando lat/lon vêm em formato inválido', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: 'abc', lon: 'def' }]));
    const adapter = new NominatimMapsAdapter();

    await expect(adapter.geocode('endereço estranho')).resolves.toBeNull();
  });

  it('respeita o limite de 1 req/s — a segunda chamada só dispara o fetch depois de ~1000ms', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '-17.88', lon: '-51.71' }]));
    const adapter = new NominatimMapsAdapter();

    const first = adapter.geocode('Endereço 1');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    const second = adapter.geocode('Endereço 2');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1); // ainda não passou 1s desde a primeira

    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2); // agora sim, ~1000ms depois

    await Promise.all([first, second]);
    vi.useRealTimers();
  });
});
