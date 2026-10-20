import type { GeoPoint, IRouteService, RouteDistance } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { RouteAdapter } from '../adapters/route-adapter';

/** Até ~1 m: dois cliques no mesmo lugar do mapa reaproveitam o resultado. */
const CACHE_PRECISION = 5;

/**
 * Teto do cache em memória. Cada chamada à API do Google custa (e o custo é
 * dos stakeholders); repetir a mesma rota é comum (mesma origem, mesma
 * fazenda). Mas sem teto o Map cresceria sem limite no processo.
 */
const CACHE_MAX_ENTRIES = 1000;

/**
 * Km automático do orçamento — Dev 1 é o dono. Orquestra e cacheia; a
 * chamada à API externa é do RouteAdapter (Dev 2), no mesmo desenho do
 * GeoService com o MapsAdapter.
 *
 * Só a ida, de onde o vet saiu até o ponto do atendimento (decisão do
 * Marco, 20/10/2026: a origem é informada em cada orçamento).
 */
export class RouteService implements IRouteService {
  private readonly cache = new Map<string, RouteDistance | null>();

  constructor(private readonly adapter: RouteAdapter) {}

  async distance(origin: GeoPoint, destination: GeoPoint): Promise<RouteDistance | null> {
    requireValidPoint(origin, 'origin');
    requireValidPoint(destination, 'destination');

    const key = `${pointKey(origin)}>${pointKey(destination)}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    // Mesmo lugar: não gasta chamada da API.
    const raw =
      pointKey(origin) === pointKey(destination)
        ? { distanceKm: 0, durationMinutes: 0 }
        : await this.adapter.route(origin, destination);
    const result = raw && {
      distanceKm: Math.round(raw.distanceKm * 10) / 10,
      durationMinutes: Math.round(raw.durationMinutes),
    };

    // Falha (null) não fica no cache: a API pode voltar no minuto seguinte.
    if (result) this.remember(key, result);
    return result;
  }

  private remember(key: string, value: RouteDistance): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Map guarda a ordem de inserção: o primeiro é o mais antigo.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}

function pointKey(point: GeoPoint): string {
  return `${point.latitude.toFixed(CACHE_PRECISION)},${point.longitude.toFixed(CACHE_PRECISION)}`;
}

function requireValidPoint(point: GeoPoint, field: string): void {
  const valid =
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180;
  if (!valid) {
    throw AppError.validation('Coordenadas inválidas', [
      { field, message: 'Latitude entre -90 e 90 e longitude entre -180 e 180' },
    ]);
  }
}
