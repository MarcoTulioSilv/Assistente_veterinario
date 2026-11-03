import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { GeoPoint, RouteDistance } from '@quironequine/shared-types';
import type { RouteAdapter } from './route-adapter';

const log = createServiceLogger('osrm-route-adapter');

interface OsrmRouteResponse {
  code: string;
  routes?: Array<{
    /** Metros. */
    distance: number;
    /** Segundos. */
    duration: number;
  }>;
}

/**
 * RouteAdapter real — Dev 2 (ADR-001 §8.2). OSRM (Open Source Routing
 * Machine), perfil `driving`. Decisão da reunião de 2026-11-03: o Google
 * Maps está bloqueado neste projeto (`OR_BACR2_44`), então a rota usa o
 * servidor público de demonstração do OSRM
 * (https://router.project-osrm.org) — gratuito, sem API key, mesmo padrão
 * de uso livre já aceito neste projeto pro Nominatim (NominatimMapsAdapter).
 *
 * Aviso (igual Nominatim): é um servidor de demonstração, não tem SLA de
 * produção, e endereços/vias rurais têm cobertura de mapa mais fraca que em
 * área urbana — a tela sempre deixa o km editável à mão por isso.
 *
 * Devolve km/minutos CRUS (o RouteService arredonda); nunca lança — sem
 * rota de carro, API fora, ou qualquer erro de rede vira `null`, mesmo
 * contrato do `MockRouteAdapter` (o orçamento continua com o km digitado à
 * mão).
 */
export class OsrmRouteAdapter implements RouteAdapter {
  private static readonly BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
  private static readonly TIMEOUT_MS = 5000;

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteDistance | null> {
    // OSRM espera lon,lat (ao contrário do GeoPoint, que é lat/lon).
    const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = `${OsrmRouteAdapter.BASE_URL}/${coords}?overview=false`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(OsrmRouteAdapter.TIMEOUT_MS) });

      if (!res.ok) {
        log.warn({ status: res.status }, 'OSRM respondeu com erro HTTP, rota indisponível');
        return null;
      }

      const body = (await res.json()) as OsrmRouteResponse;
      if (body.code !== 'Ok') {
        // Ex.: "NoRoute" -- não é erro, é "sem rota de carro entre os pontos".
        return null;
      }

      const route = body.routes?.[0];
      if (!route) return null;

      return {
        distanceKm: route.distance / 1000,
        durationMinutes: route.duration / 60,
      };
    } catch (err) {
      log.warn({ err }, 'Falha ao chamar o OSRM (rede/timeout), rota indisponível');
      return null;
    }
  }
}
