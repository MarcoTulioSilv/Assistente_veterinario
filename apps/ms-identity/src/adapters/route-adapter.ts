import type { GeoPoint, RouteDistance } from '@quironequine/shared-types';

/**
 * Integração externa — Dev 2 é o dono (ADR-001 §8.2, "adapters/").
 *
 * RouteAdapter calcula a distância de carro entre dois pontos para o km
 * automático do orçamento (reunião com os stakeholders de 20/10/2026). É
 * separado do MapsAdapter de propósito: a geocodificação já tem
 * implementação real (Nominatim/OpenStreetMap), e a rota tem a própria
 * implementação (ver `osrm-route-adapter.ts`) — juntar os dois obrigaria o
 * adapter de geocodificação a saber calcular rota.
 *
 * ATUALIZAÇÃO (reunião 2026-11-03): o uso do Google Maps está bloqueado
 * neste projeto (código de referência `OR_BACR2_44`) — a implementação real
 * é `OsrmRouteAdapter` (OSRM, servidor público, sem API key), não Google.
 * Se o bloqueio for revisto no futuro, trocar a implementação concreta é
 * só escrever outra classe atrás desta mesma interface.
 *
 * Contrato: devolve a distância e a duração CRUAS (sem arredondar — o
 * RouteService arredonda) e `null` quando não há rota de carro, a API
 * recusa ou não responde. Nunca lança por falha da API externa: o
 * orçamento continua com o km digitado à mão.
 */
export interface RouteAdapter {
  route(origin: GeoPoint, destination: GeoPoint): Promise<RouteDistance | null>;
}

/** Placeholder pros testes: rota sempre indisponível (a tela pede o km à mão). */
export class MockRouteAdapter implements RouteAdapter {
  async route(_origin: GeoPoint, _destination: GeoPoint): Promise<RouteDistance | null> {
    return null;
  }
}
