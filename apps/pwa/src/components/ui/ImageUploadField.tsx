'use client';

import { useId, useRef, useState } from 'react';
import { UPLOAD_IMAGE_EXTENSIONS, UPLOAD_MAX_FILE_SIZE_BYTES } from '@quironequine/shared-types';
import { cn } from '@/lib/cn';
import { api, ApiClientError } from '@/lib/api';
import { Spinner } from './Spinner';

// Só um pre-check de UX (feedback rápido sem round-trip ao servidor) --
// quem decide de verdade se o arquivo é uma imagem válida é o backend,
// pelos bytes reais (sniffImageMimeType em image-sniff.ts), não por essa
// checagem de Content-Type do <input type="file">, que o browser também
// só infere e não é uma garantia de conteúdo.
const ACCEPTED_TYPES = Object.keys(UPLOAD_IMAGE_EXTENSIONS);

export interface ImageUploadFieldProps {
  label: string;
  hint?: string;
  /** URL atual (já hospedada ou resultado de um upload anterior); '' = nenhuma. */
  value: string;
  onChange: (url: string) => void;
  error?: string;
}

/**
 * Upload de imagem de verdade (JPEG/PNG/WebP, até 5MB) via api.uploads.upload()
 * — POST /uploads no ms-identity, LocalStorageAdapter grava em disco e devolve
 * uma URL pública. `value` continua sendo uma string de URL simples por baixo
 * (mesmo campo que antes só aceitava colar um link já hospedado), então isto
 * é uma troca de UI sem mudar o formato do dado nem o contrato com o backend.
 */
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  error,
}: ImageUploadFieldProps): React.ReactElement {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError('Envie um arquivo JPEG, PNG ou WebP');
      return;
    }
    if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
      setUploadError('Arquivo maior que 5MB');
      return;
    }

    setUploadError(undefined);
    setUploading(true);
    try {
      const { url } = await api.uploads.upload(file);
      onChange(url);
    } catch (err) {
      setUploadError(err instanceof ApiClientError ? err.body.message : 'Falha ao enviar o arquivo');
    } finally {
      setUploading(false);
    }
  }

  const displayError = error ?? uploadError;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-50',
            displayError ? 'border-red-500' : 'border-slate-300',
          )}
        >
          {uploading ? (
            <Spinner size="sm" />
          ) : value ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              title="Ver em tamanho real"
              className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <img src={value} alt="" className="h-full w-full object-cover" />
            </a>
          ) : (
            <span className="text-xs text-slate-400">sem foto</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            id={inputId}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {uploading ? 'Enviando…' : value ? 'Trocar imagem' : 'Escolher imagem'}
          </button>
          {value && !uploading && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-sm text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Remover
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={(e) => void handleFileChange(e)}
          className="hidden"
        />
      </div>
      {displayError ? (
        <span role="alert" className="text-sm text-red-600">
          {displayError}
        </span>
      ) : hint ? (
        <span className="text-sm text-slate-500">{hint}</span>
      ) : null}
    </div>
  );
}
