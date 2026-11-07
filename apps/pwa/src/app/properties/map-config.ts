import { LocationPickerGoogle } from './LocationPickerGoogle';

export type { LocationPickerProps } from './LocationPicker';

/**
 * Ponto único de troca do mapa de localização (demo/pwa-githubpages). Pra
 * voltar pro Leaflet/OSM: troque a linha abaixo por
 * `export { LocationPicker as ActiveLocationPicker } from './LocationPicker';`
 * (e apague o import acima) -- as telas que usam o picker (properties/new,
 * AppointmentForm) importam daqui, nunca direto de
 * LocationPicker/LocationPickerGoogle.
 */
export const ActiveLocationPicker = LocationPickerGoogle;
