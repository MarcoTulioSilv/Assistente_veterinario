'use client';

import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { Button } from '@/components/ui';
import { LocationPicker, type LocationPickerProps } from './LocationPicker';

const BRAZIL_CENTER = { lat: -14.235, lng: -51.9253 };

const BROWSER_KEY = process.env['NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY'];

interface Libraries {
  Map: typeof google.maps.Map;
  Marker: typeof google.maps.Marker;
}

let librariesPromise: Promise<Libraries> | null = null;

/**
 * Um load só pra toda a página -- `setOptions` só pode ser chamado antes de
 * qualquer `importLibrary`, e chamar duas vezes gera warning. API funcional
 * (`setOptions`/`importLibrary`), não a `Loader` antiga (removida na v2 do
 * @googlemaps/js-api-loader).
 */
function loadGoogleMaps(apiKey: string): Promise<Libraries> {
  librariesPromise ??= (async () => {
    setOptions({ key: apiKey, v: 'weekly' });
    const [mapsLib, markerLib] = await Promise.all([importLibrary('maps'), importLibrary('marker')]);
    return { Map: mapsLib.Map, Marker: markerLib.Marker };
  })();
  return librariesPromise;
}

/**
 * Mesmas props e mesma saída do LocationPicker (Leaflet) -- quem usa não
 * precisa saber qual mapa está por baixo (ver map-config.ts). Só pra a demo
 * estática (GitHub Pages): a chave é restrita por referenciador HTTP no
 * Google Cloud, nunca secreta -- ok embutir no bundle do navegador.
 *
 * google.maps.Marker (clássico, não AdvancedMarkerElement) de propósito:
 * o Advanced Marker exige um Map ID cadastrado no Cloud Console, que a demo
 * não tem como garantir que existe -- preferível não depender disso.
 *
 * Sem chave configurada, ou se o carregamento do script falhar (rede,
 * chave revogada, cota), cai pro LocationPicker de Leaflet sem quebrar a
 * tela -- a demo não pode depender de um serviço externo pago pra existir.
 */
export function LocationPickerGoogle(props: LocationPickerProps): React.ReactElement {
  const { value, onChange, zipCode } = props;
  const [failed, setFailed] = useState(false);
  const [searchingCep, setSearchingCep] = useState(false);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const markerClassRef = useRef<typeof google.maps.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Posição inicial só importa na criação do mapa -- igual ao RecenterOnChange
  // do Leaflet, mudanças de `value` depois (CEP, geolocalização) recentralizam
  // num efeito separado abaixo, sem recriar o mapa.
  const initialValueRef = useRef(value);

  function placeMarker(map: google.maps.Map, position: google.maps.LatLngLiteral): void {
    if (markerRef.current) {
      markerRef.current.setPosition(position);
      return;
    }
    const MarkerClass = markerClassRef.current;
    if (!MarkerClass) return;
    const marker = new MarkerClass({ map, position, draggable: true });
    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (pos) onChangeRef.current({ latitude: pos.lat(), longitude: pos.lng() });
    });
    markerRef.current = marker;
  }

  useEffect(() => {
    if (!BROWSER_KEY) {
      setFailed(true);
      return;
    }
    if (!mapDivRef.current) return;

    let cancelled = false;
    const initial = initialValueRef.current;

    loadGoogleMaps(BROWSER_KEY)
      .then(({ Map, Marker }) => {
        if (cancelled || !mapDivRef.current) return;
        markerClassRef.current = Marker;

        const center = initial ? { lat: initial.latitude, lng: initial.longitude } : BRAZIL_CENTER;
        const map = new Map(mapDivRef.current, { center, zoom: initial ? 15 : 4 });
        mapRef.current = map;

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            const position = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            placeMarker(map, position);
            onChangeRef.current({ latitude: position.lat, longitude: position.lng });
          }
        });

        if (initial) placeMarker(map, center);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // Só na montagem -- recriar o mapa a cada mudança de `value` reiniciaria
    // zoom/pan do usuário (mesma razão do RecenterOnChange separado no Leaflet).
  }, []);

  // Recentra e reposiciona o pino quando `value` muda por fora (CEP, "usar
  // minha localização") -- não recria o mapa, só move a câmera/o marcador.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    const position = { lat: value.latitude, lng: value.longitude };
    map.panTo(position);
    map.setZoom(15);
    placeMarker(map, position);
  }, [value?.latitude, value?.longitude]);

  // Busca automática no mapa quando o CEP fica completo (000-000) --
  // Nominatim (mesmo serviço do LocationPicker de Leaflet e do GeoService no
  // backend, RF-CAD-002). A chave do navegador é só pra Maps JavaScript API
  // (não pra Geocoding), então o CEP continua resolvido por fora do Google.
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
          if (first) onChangeRef.current({ latitude: Number(first.lat), longitude: Number(first.lon) });
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

  if (failed) return <LocationPicker {...props} />;

  function useMyLocation(): void {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Localização exata</span>
        <Button type="button" variant="ghost" size="sm" onClick={useMyLocation}>
          Usar minha localização
        </Button>
      </div>
      <div ref={mapDivRef} className="h-56 w-full overflow-hidden rounded-md border border-slate-300" />
      <span className="text-sm text-slate-500">
        {searchingCep
          ? 'Buscando o CEP no mapa…'
          : value
            ? `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)} — arraste o pino pra ajustar`
            : 'Toque no mapa pra marcar o pino, preencha o CEP ou use sua localização'}
      </span>
    </div>
  );
}
