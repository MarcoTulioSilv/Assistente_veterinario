'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api';

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
  /** Avisa quem estiver renderizando o campo de CEP sobre o erro da busca (ex: "CEP não encontrado"). */
  onZipCodeError?: (message: string | null) => void;
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

export function LocationPicker({
  value,
  onChange,
  zipCode,
  onZipCodeError,
}: LocationPickerProps): React.ReactElement {
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchingCep, setSearchingCep] = useState(false);

  // Busca automática no mapa quando o CEP fica completo (00000-000) -- pelo
  // BFF/MS1 (auditoria/pedido do João: nada de chamar o Nominatim direto do
  // navegador), mesmo adapter do GeoService (RF-CAD-002).
  useEffect(() => {
    if (!zipCode || !/^\d{5}-\d{3}$/.test(zipCode)) return;

    let cancelled = false;
    setSearchingCep(true);
    onZipCodeError?.(null);
    const timer = setTimeout(() => {
      api.geo
        .geocodeZip(zipCode)
        .then((result) => {
          if (cancelled) return;
          if (result) {
            onChange(result);
          } else {
            onZipCodeError?.('CEP não encontrado');
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Busca automática é auxiliar -- nunca bloqueia o cadastro, só avisa.
          const message =
            err instanceof ApiClientError ? err.body.message : 'Não foi possível buscar o CEP agora';
          onZipCodeError?.(message);
        })
        .finally(() => {
          if (!cancelled) setSearchingCep(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
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
