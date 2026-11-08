import { LocationPicker } from './LocationPicker';
import { LocationPickerGoogle } from './LocationPickerGoogle';

export type { LocationPickerProps } from './LocationPicker';

/**
 * Ponto único de troca do mapa de localização. Google Maps (Maps JavaScript
 * API) quando a chave do navegador está configurada
 * (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, restrita por referenciador HTTP no
 * Google Cloud); Leaflet/OSM quando não está -- quem não tiver a chave
 * configurada continua funcionando sem quebrar. LocationPickerGoogle
 * também cai pro Leaflet por conta própria se o carregamento do script
 * falhar em runtime (rede, chave revogada, cota); a escolha aqui decide o
 * caminho "sem chave" ANTES de tentar montar o mapa, evitando o flash do
 * container vazio nesse caso.
 */
export const ActiveLocationPicker = process.env['NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY']
  ? LocationPickerGoogle
  : LocationPicker;
