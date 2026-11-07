/**
 * Integração externa — Dev 2 é o dono (ADR-001 §8.2, "adapters/").
 *
 * MapsAdapter é quem chama a API real do Google Maps (ou equivalente,
 * RF-CAD-002). GeoService (Dev1, services/geo.service.ts) só orquestra
 * e cacheia — não sabe nada sobre a API externa em si.
 *
 * MockMapsAdapter abaixo é o placeholder até o Dev2 entregar a
 * implementação real: retorna sempre null (geocoding indisponível),
 * um estado já tratado normalmente pelo GeoService — nunca bloqueia o
 * cadastro de uma propriedade.
 */
export interface MapsAdapter {
  geocode(address: string): Promise<{ latitude: number; longitude: number } | null>;
}

export class MockMapsAdapter implements MapsAdapter {
  async geocode(_address: string): Promise<{ latitude: number; longitude: number } | null> {
    return null;
  }
}
