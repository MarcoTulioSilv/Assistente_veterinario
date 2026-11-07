import type { MapsAdapter } from '../adapters/maps-adapter';

interface AddressInput {
  latitude?: number;
  longitude?: number;
  address?: string;
  city?: string;
  state?: string;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Orquestração + cache de geocoding (RF-CAD-002) — Dev 1 é o dono.
 * A chamada de verdade à API de mapas é do MapsAdapter (Dev2).
 */
export class GeoService {
  private readonly cache = new Map<string, Coordinates | null>();

  constructor(private readonly adapter: MapsAdapter) {}

  /**
   * Se lat/lng já vieram prontos (fluxo de mapa interativo, usuário
   * arrasta um pino), usa direto — nunca chama geocoding nesse caso.
   * Senão, tenta geocodificar a partir do endereço textual, se houver
   * dados suficientes. Retorna null se não há como resolver (não é
   * erro — a propriedade só fica sem coordenadas por enquanto).
   */
  async resolveCoordinates(input: AddressInput): Promise<Coordinates | null> {
    if (input.latitude !== undefined && input.longitude !== undefined) {
      return { latitude: input.latitude, longitude: input.longitude };
    }

    if (!input.address || !input.city || !input.state) {
      return null;
    }

    const key = normalizeAddress(input.address, input.city, input.state);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = await this.adapter.geocode(key);
    this.cache.set(key, result);
    return result;
  }
}

function normalizeAddress(address: string, city: string, state: string): string {
  return `${address}, ${city} - ${state}`.trim().toLowerCase();
}
