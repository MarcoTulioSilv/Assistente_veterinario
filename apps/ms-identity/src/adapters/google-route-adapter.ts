import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { GeoPoint, RouteDistance } from '@quironequine/shared-types';
import type { RouteAdapter } from './route-adapter';

const log = createServiceLogger('google-route-adapter');

interface ComputeRoutesResponse {
  routes?: Array<{
    distanceMeters?: number;
    /** Formato "123s" (segundos, com o sufixo) — ver parseDurationSeconds. */
    duration?: string;
  }>;
}

/** "679s" -> 679. `NaN` em formato inesperado — tratado como rota indisponível. */
function parseDurationSeconds(duration: string): number {
  return Number(duration.replace(/s$/, ''));
}

function toLatLng(point: GeoPoint): { latLng: { latitude: number; longitude: number } } {
  return { latLng: { latitude: point.latitude, longitude: point.longitude } };
}

/**
 * RouteAdapter real — Dev 2 (ADR-001 §8.2). Routes API do Google
 * (computeRoutes), modo DRIVE. Chave em GOOGLE_MAPS_API_KEY — dos
 * stakeholders (contrato, Cláusula 2ª), por isso o cálculo fica só aqui no
 * servidor, nunca no navegador (RF do orçamento, reunião 20/10/2026).
 *
 * Devolve km/minutos CRUS, sem arredondar — o RouteService (Dev 1) faz
 * isso. Nunca lança: sem rota de carro, API fora, chave ausente/inválida ou
 * qualquer erro de rede vira `null`, o mesmo contrato do MockRouteAdapter —
 * o orçamento continua com o km digitado à mão.
 */
export class GoogleRouteAdapter implements RouteAdapter {
  private static readonly BASE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly apiKey: string) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteDistance | null> {
    if (!this.apiKey) {
      log.warn('GOOGLE_MAPS_API_KEY ausente — rota indisponível');
      return null;
    }

    try {
      const res = await fetch(GoogleRouteAdapter.BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          // Só os campos usados — a Routes API cobra por campo solicitado.
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: toLatLng(origin),
          destination: toLatLng(destination),
          travelMode: 'DRIVE',
        }),
        signal: AbortSignal.timeout(GoogleRouteAdapter.TIMEOUT_MS),
      });

      if (!res.ok) {
        log.warn({ status: res.status }, 'Routes API respondeu com erro, rota indisponível');
        return null;
      }

      const body = (await res.json()) as ComputeRoutesResponse;
      const route = body.routes?.[0];
      if (!route || route.distanceMeters === undefined || route.duration === undefined) {
        // Sem rota de carro entre os pontos (routes vazio) — não é erro.
        return null;
      }

      const durationSeconds = parseDurationSeconds(route.duration);
      if (Number.isNaN(durationSeconds)) return null;

      return {
        distanceKm: route.distanceMeters / 1000,
        durationMinutes: durationSeconds / 60,
      };
    } catch (err) {
      log.warn({ err }, 'Falha ao chamar a Routes API (rede/timeout), rota indisponível');
      return null;
    }
  }
}
