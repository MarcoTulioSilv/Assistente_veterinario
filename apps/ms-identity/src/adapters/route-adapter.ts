import type { GeoPoint, RouteDistance } from '@quironequine/shared-types';

/**
 * Integração externa — Dev 2 é o dono (ADR-001 §8.2, "adapters/").
 *
 * RouteAdapter calcula a distância de carro entre dois pontos para o km
 * automático do orçamento (reunião com os stakeholders de 20/10/2026). É
 * separado do MapsAdapter de propósito: a geocodificação já tem
 * implementação real (Nominatim/OpenStreetMap), e a rota vai pelo Google
 * Maps — pedido explícito dos stakeholders. Juntar os dois obrigaria o
 * adapter de geocodificação a saber calcular rota.
 *
 * Implementação real (João): GoogleRouteAdapter com a Routes API (ou
 * Distance Matrix), chave em GOOGLE_MAPS_API_KEY (já no .env.example).
 * Deve devolver a distância e a duração CRUAS (metros/segundos convertidos
 * em km/minutos, sem arredondar — o RouteService arredonda) e `null` quando
 * não há rota de carro, a API recusa ou não responde. Nunca lança por falha
 * da API externa: o orçamento continua com o km digitado à mão.
 */
export interface RouteAdapter {
  route(origin: GeoPoint, destination: GeoPoint): Promise<RouteDistance | null>;
}

/** Placeholder até o adapter do Google: rota sempre indisponível (a tela pede o km à mão). */
export class MockRouteAdapter implements RouteAdapter {
  async route(_origin: GeoPoint, _destination: GeoPoint): Promise<RouteDistance | null> {
    return null;
  }
}
