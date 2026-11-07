'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui';

// Os ícones default do Leaflet apontam pra arquivos que o bundler não
// resolve (problema conhecido leaflet + webpack/turbopack) -- aponta pro
// CDN em vez de tentar empacotar os PNGs.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const BRAZIL_CENTER: [number, number] = [-14.235, -51.9253];

export interface LocationPickerProps {
  value: { latitude: number; longitude: number } | null;
  onChange: (coords: { latitude: number; longitude: number }) => void;
  /** CEP (000-000) digitado no formulário -- dispara busca automática no mapa. */
  zipCode?: string;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }): null {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * MapContainer só usa `center`/`zoom` na criação do mapa -- mudanças
 * depois não recentralizam sozinhas (limitação conhecida do
 * react-leaflet). Isso força o recentro sempre que a coordenada muda,
 * seja por clique, geolocalização ou busca por CEP.
 */
function RecenterOnChange({ value }: { value: { latitude: number; longitude: number } | null }): null {
  const map = useMap();
  useEffect(() => {
    if (value) map.setView([value.latitude, value.longitude], 15);
  }, [value?.latitude, value?.longitude, map]);
  return null;
}

export function LocationPicker({ value, onChange, zipCode }: LocationPickerProps): React.ReactElement {
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchingCep, setSearchingCep] = useState(false);

  // Busca automática no mapa quando o CEP fica completo (000-000) --
  // Nominatim (mesmo serviço do GeoService no backend, RF-CAD-002).
  useEffect(() => {
    if (!zipCode || !/^\d{5}-\d{3}$/.test(zipCode)) return;

    const controller = new AbortController();
    setSearchingCep(true);
    const timer = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zipCode)}&country=Brazil&format=json&limit=1`,
        { signal: controller.signal },
      )
        .then((res) => (res.ok ? res.json() : []))
        .then((results: Array<{ lat: string; lon: string }>) => {
          const first = results[0];
          if (first) onChange({ latitude: Number(first.lat), longitude: Number(first.lon) });
        })
        .catch(() => undefined) // busca automática é auxiliar -- nunca bloqueia o cadastro
        .finally(() => setSearchingCep(false));
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setSearchingCep(false);
    };
  }, [zipCode]);

  function useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocalização não é suportada neste navegador.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoError(null);
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => setGeoError('Não foi possível obter sua localização.'),
    );
  }

  const center: [number, number] = value ? [value.latitude, value.longitude] : BRAZIL_CENTER;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Localização exata</span>
        <Button type="button" variant="ghost" size="sm" onClick={useMyLocation}>
          Usar minha localização
        </Button>
      </div>
      <div className="h-56 w-full overflow-hidden rounded-md border border-slate-300">
        <MapContainer
          center={center}
          zoom={value ? 15 : 4}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPlace={(lat, lng) => onChange({ latitude: lat, longitude: lng })} />
          <RecenterOnChange value={value} />
          {value && (
            <Marker
              position={[value.latitude, value.longitude]}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target as L.Marker;
                  const pos = marker.getLatLng();
                  onChange({ latitude: pos.lat, longitude: pos.lng });
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <span className="text-sm text-slate-500">
        {searchingCep
          ? 'Buscando o CEP no mapa…'
          : value
            ? `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)} — arraste o pino pra ajustar`
            : 'Toque no mapa pra marcar o pino, preencha o CEP ou use sua localização'}
      </span>
      {geoError && <span className="text-sm text-red-600">{geoError}</span>}
    </div>
  );
}
