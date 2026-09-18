import { createServiceLogger } from '@quironequine/shared-middlewares';
import type { MapsAdapter } from './maps-adapter';

const log = createServiceLogger('nominatim-maps-adapter');

interface NominatimResult {
  lat: string;
  lon: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MapsAdapter real — Dev 2 (ADR-001 §8.2). Usa o Nominatim (OpenStreetMap)
 * em vez do Google Maps: gratuito, sem API key/cartão. Mesma interface —
 * trocar pro Google no futuro é só escrever outra classe.
 *
 * Política de uso do Nominatim (https://operations.osmfoundation.org/policies/nominatim/)
 * exige: User-Agent identificando a aplicação e no máximo 1 req/s — as
 * chamadas desta instância são serializadas (fila interna) pra respeitar
 * isso mesmo se o GeoService disparar várias em sequência.
 *
 * Nunca lança erro: endereço não encontrado, rede fora, timeout — tudo
 * vira null, o mesmo contrato do MockMapsAdapter. GeoService/PropertyService
 * já tratam null como "geocoding indisponível agora", nunca bloqueiam o
 * cadastro por causa disso.
 */
export class NominatimMapsAdapter implements MapsAdapter {
  private static readonly BASE_URL = 'https://nominatim.openstreetmap.org/search';
  private static readonly USER_AGENT = 'QuironEquine/1.0 (contato@quironequine.com)';
  private static readonly MIN_INTERVAL_MS = 1000;
  private static readonly TIMEOUT_MS = 5000;

  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  async geocode(address: string): Promise<{ latitude: number; longitude: number } | null> {
    // Encadeia na fila para serializar as chamadas (rate limit de 1 req/s).
    const result = this.queue.then(() => this.throttledFetch(address));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async throttledFetch(
    address: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = NominatimMapsAdapter.MIN_INTERVAL_MS - elapsed;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();

    return this.fetchCoordinates(address);
  }

  private async fetchCoordinates(
    address: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const url = new URL(NominatimMapsAdapter.BASE_URL);
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': NominatimMapsAdapter.USER_AGENT },
        signal: AbortSignal.timeout(NominatimMapsAdapter.TIMEOUT_MS),
      });

      if (!res.ok) {
        log.warn({ address, status: res.status }, 'Nominatim respondeu com erro, geocoding indisponível');
        return null;
      }

      const results = (await res.json()) as NominatimResult[];
      const first = results[0];
      if (!first) return null;

      const latitude = Number(first.lat);
      const longitude = Number(first.lon);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

      return { latitude, longitude };
    } catch (err) {
      log.warn({ err, address }, 'Falha ao chamar Nominatim (rede/timeout), geocoding indisponível');
      return null;
    }
  }
}
