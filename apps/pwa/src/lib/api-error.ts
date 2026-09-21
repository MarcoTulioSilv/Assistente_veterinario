import type { ApiError } from '@quironequine/shared-types';

/**
 * Separado de api.ts pra evitar import circular: api.ts importa apiDemo de
 * api.demo.ts (modo demo, ver NEXT_PUBLIC_DEMO_MODE), e api.demo.ts precisa
 * desta classe pra devolver erros na mesma forma que o cliente real -- se
 * ela morasse em api.ts, os dois arquivos importariam um do outro.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
    this.name = 'ApiClientError';
  }
}
