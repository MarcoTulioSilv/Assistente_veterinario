import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Hash de senha — usado por AuthService (login) e TenantService (senha do
 * admin no cadastro). Um lugar só para a política.
 *
 * scrypt nativo do Node (auditoria 06/11/2026, M-04). O bcryptjs é JS puro
 * e roda na thread principal: alguns logins simultâneos travavam o
 * ms-identity inteiro. O crypto.scrypt roda no threadpool do libuv, sem
 * módulo nativo de terceiro (bcrypt/argon2 dão problema na imagem ARM).
 *
 * Formato autodescrito: `scrypt$N$r$p$<sal base64>$<hash base64>`. Os
 * parâmetros viajam com o hash, então dá para endurecê-los depois: o login
 * certo refaz o hash de quem estiver com parâmetros antigos ou com bcrypt
 * (`needsRehash`).
 *
 * Parâmetros: N=2^15, r=8, p=3 — uma das combinações equivalentes da OWASP
 * (Password Storage Cheat Sheet), com 32 MiB por operação em vez de 128.
 */
const SCRYPT_PREFIX = 'scrypt';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const CURRENT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };

/** Teto para parâmetros vindos de um hash gravado: barra um hash adulterado que pediria gigabytes. */
const MAX_N = 2 ** 17;

function scrypt(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // O padrão do Node (32 MiB) fica no limite exato de N=2^15, r=8.
    maxmem: 128 * params.N * params.r * 2,
  };
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string, params: ScryptParams = CURRENT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, params);
  return [SCRYPT_PREFIX, params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export interface PasswordCheck {
  ok: boolean;
  /** Senha certa, mas o hash é bcrypt ou scrypt com parâmetros antigos: refazer. */
  needsRehash: boolean;
}

function parseScrypt(hash: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  if (r < 1 || r > 16 || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const key = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || key.length !== KEY_LENGTH) return null;
  return { params: { N, r, p }, salt, key };
}

export async function verifyPassword(password: string, hash: string): Promise<PasswordCheck> {
  if (hash.startsWith('$2')) {
    // Legado (bcryptjs): aceito até a pessoa entrar de novo e ganhar o hash scrypt.
    const ok = await bcrypt.compare(password, hash);
    return { ok, needsRehash: ok };
  }

  const parsed = parseScrypt(hash);
  if (!parsed) return { ok: false, needsRehash: false };

  const key = await scrypt(password, parsed.salt, parsed.params);
  const ok = timingSafeEqual(key, parsed.key);
  const { N, r, p } = parsed.params;
  const outdated = N !== CURRENT_SCRYPT.N || r !== CURRENT_SCRYPT.r || p !== CURRENT_SCRYPT.p;
  return { ok, needsRehash: ok && outdated };
}

/**
 * Alvo de comparação quando o e-mail não existe ou a conta está bloqueada:
 * o login gasta o mesmo tempo de uma senha errada, e a resposta não revela
 * se a conta existe (enumeração por tempo). Gerado uma vez, na primeira
 * chamada, com os parâmetros atuais.
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-timing-safety');
  return dummyHash;
}
