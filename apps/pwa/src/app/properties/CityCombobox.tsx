'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';

export interface CityComboboxProps {
  value: string;
  onChange: (city: string) => void;
  /** UF selecionada (2 letras) -- sem isso não dá pra saber quais cidades buscar. */
  state: string;
  error?: string;
}

interface IbgeMunicipio {
  nome: string;
}

/** Remove acento pra busca não exigir digitar "ã", "ç" etc. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const MAX_SUGGESTIONS = 8;

/**
 * Combobox de cidade com busca (Melhoria C, pedido do João): filtra as
 * cidades do estado selecionado, carregadas do IBGE. Sem estado selecionado,
 * fica desabilitado -- não dá pra saber qual lista buscar. Continua
 * aceitando qualquer texto digitado (a cidade escolhida na lista é só uma
 * sugestão, não uma obrigação -- mesma permissividade do schema.ts atual).
 */
export function CityCombobox({ value, onChange, state, error }: CityComboboxProps): React.ReactElement {
  const inputId = useId();
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!state || state.length !== 2) {
      setCities([]);
      setFetchFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchFailed(false);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`)
      .then((res) => (res.ok ? (res.json() as Promise<IbgeMunicipio[]>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return;
        setCities(data.map((m) => m.nome));
      })
      .catch(() => {
        if (cancelled) return;
        setCities([]);
        setFetchFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state]);

  const disabled = !state;
  const query = normalize(value);
  const suggestions = query
    ? cities.filter((city) => normalize(city).includes(query)).slice(0, MAX_SUGGESTIONS)
    : cities.slice(0, MAX_SUGGESTIONS);

  function selectCity(city: string): void {
    onChange(city);
    setOpen(false);
  }

  // Sem lista do IBGE (erro de rede): não trava o campo, cai pra texto livre.
  if (fetchFailed) {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          Cidade
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={cn(
            'h-10 w-full rounded-md border px-3 text-sm text-slate-900 placeholder:text-slate-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            error ? 'border-red-500' : 'border-slate-300',
          )}
        />
        <span className="text-sm text-amber-600">
          Não foi possível carregar a lista de cidades do IBGE agora -- digite livremente.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        Cidade
      </label>
      <div className="relative">
        <input
          id={inputId}
          value={value}
          disabled={disabled}
          placeholder={disabled ? 'Selecione o estado primeiro' : 'Digite para buscar'}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          aria-invalid={!!error}
          aria-expanded={open && suggestions.length > 0}
          role="combobox"
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(
            'h-10 w-full rounded-md border px-3 text-sm text-slate-900 placeholder:text-slate-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
            error ? 'border-red-500' : 'border-slate-300',
          )}
        />
        {open && !disabled && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-md">
            {suggestions.map((city) => (
              <li key={city}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectCity(city)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-primary-50 hover:text-primary-800"
                >
                  {city}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : disabled ? (
        <span className="text-sm text-slate-500">Selecione o estado primeiro</span>
      ) : loading ? (
        <span className="text-sm text-slate-500">Carregando cidades…</span>
      ) : null}
    </div>
  );
}
