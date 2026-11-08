import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';

/**
 * URLs assinadas para os arquivos enviados (auditoria 06/11/2026, M-03).
 *
 * Antes, qualquer pessoa com a URL abria a foto ou o LAUDO, sem login e para
 * sempre — e a URL vaza fácil (WhatsApp, histórico, log de proxy). Agora:
 *
 * - no banco fica a URL canônica, sem assinatura (`canonicalUploadUrl`);
 * - toda resposta da API devolve a URL assinada, válida por pouco tempo
 *   (`signUploadUrl`), com `exp` (epoch em segundos) e `sig` (HMAC-SHA256
 *   de `<chave do arquivo>\n<exp>`);
 * - a rota que serve os arquivos só entrega com assinatura válida e no
 *   prazo (`verifyUploadSignature`).
 *
 * A "chave do arquivo" é o caminho depois de /api/v1/uploads/:
 * `<tenantId>/<pasta>/<arquivo>`. O tenant faz parte da chave, e o servidor
 * só assina arquivo do tenant da sessão: um tenant que grave a URL de um
 * arquivo de outro não ganha uma assinatura para ele.
 *
 * Uma `<img src>` não manda Authorization; a assinatura na URL é o que
 * substitui o login para o navegador.
 */

const UPLOAD_PATH_RE = /^\/api\/v1\/uploads\/([0-9a-f-]{36})\/([a-z0-9_-]+)\/([A-Za-z0-9._-]+)$/i;
const DEFAULT_TTL_SECONDS = 15 * 60;

function secret(): Buffer {
  const explicit = process.env['UPLOAD_URL_SECRET'];
  if (explicit && explicit.length >= 32) return Buffer.from(explicit);
  // Sem segredo próprio: deriva um do JWT_SECRET, com rótulo — a assinatura
  // de arquivo nunca vale como assinatura de token, e vice-versa.
  const jwt = process.env['JWT_SECRET'];
  if (!jwt || jwt.length < 32) throw new Error('UPLOAD_URL_SECRET e JWT_SECRET ausentes ou curtos');
  return createHmac('sha256', jwt).update('quironequine:upload-url:v1').digest();
}

function ttlSeconds(): number {
  const raw = Number(process.env['UPLOAD_URL_TTL_SECONDS']);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
}

function mac(key: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${key}\n${exp}`).digest('base64url');
}

export interface UploadRef {
  /** `<tenantId>/<pasta>/<arquivo>` */
  key: string;
  tenantId: string;
}

/** Reconhece uma URL de upload desta API (qualquer host) e extrai a chave. */
export function parseUploadUrl(url: string): UploadRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = UPLOAD_PATH_RE.exec(parsed.pathname);
  if (!match) return null;
  const [, tenantId, folder, file] = match as unknown as [string, string, string, string];
  return { key: `${tenantId}/${folder}/${file}`, tenantId: tenantId.toLowerCase() };
}

/**
 * Para gravar: tira `exp`/`sig` (a tela devolve a URL que recebeu
 * assinada) e recusa arquivo de outro tenant. URL que não é de upload desta
 * API (ex.: logo hospedado fora) passa como veio.
 * Devolve `null` quando a URL é de upload de OUTRO tenant.
 */
export function canonicalUploadUrl(url: string, tenantId: string): string | null {
  const ref = parseUploadUrl(url);
  if (!ref) return url;
  if (ref.tenantId !== tenantId.toLowerCase()) return null;
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * `canonicalUploadUrl` para os campos de entrada: `undefined`/`null` passam
 * como vieram (PATCH parcial, limpar o campo); arquivo de outro tenant é 422.
 */
export function ownUploadUrl<T extends string | null | undefined>(url: T, tenantId: string, field: string): T {
  if (typeof url !== 'string') return url;
  const canonical = canonicalUploadUrl(url, tenantId);
  if (canonical === null) {
    throw AppError.validation('O arquivo não pertence a esta clínica', [{ field, message: 'O arquivo não pertence a esta clínica' }]);
  }
  return canonical as T;
}

/**
 * Para responder: assina a URL de upload do próprio tenant. Arquivo de outro
 * tenant volta sem assinatura (não abre); URL externa volta como veio.
 */
export function signUploadUrl(url: string, tenantId: string, now?: Date): string;
export function signUploadUrl(url: string | null, tenantId: string, now?: Date): string | null;
export function signUploadUrl(url: string | null, tenantId: string, now: Date = new Date()): string | null {
  if (!url) return url;
  const ref = parseUploadUrl(url);
  if (!ref) return url;
  const parsed = new URL(url);
  const base = `${parsed.origin}${parsed.pathname}`;
  if (ref.tenantId !== tenantId.toLowerCase()) return base;
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds();
  return `${base}?exp=${exp}&sig=${mac(ref.key, exp)}`;
}

/**
 * Para servir: `key` é o caminho depois de /uploads/ (sem a barra inicial).
 * Falso se faltar assinatura, se ela não bater ou se o prazo passou.
 */
export function verifyUploadSignature(
  key: string,
  exp: unknown,
  sig: unknown,
  now: Date = new Date(),
): boolean {
  if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(exp)) return false;
  const expNum = Number(exp);
  if (expNum < Math.floor(now.getTime() / 1000)) return false;
  const expected = Buffer.from(mac(key, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
