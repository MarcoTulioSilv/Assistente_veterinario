import { NominatimMapsAdapter } from './nominatim-maps-adapter';

/**
 * Instância única do MapsAdapter real, compartilhada entre property.controller.ts
 * (geocoding ao criar/editar propriedade) e geo.controller.ts (busca de CEP).
 * O Nominatim só aceita 1 req/s, e NominatimMapsAdapter serializa as chamadas
 * numa fila própria da instância -- duas instâncias somariam até 2 req/s.
 */
export const mapsAdapter = new NominatimMapsAdapter();
