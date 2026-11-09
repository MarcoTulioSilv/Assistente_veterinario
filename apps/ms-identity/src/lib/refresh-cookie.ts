import type { Request, Response, CookieOptions } from 'express';

/**
 * Refresh token em cookie HttpOnly (auditoria 06/11/2026, A-03).
 *
 * O JavaScript da PWA nunca vê o refresh token: um XSS leva no máximo o
 * access token de 15 min, que fica só em memória. O cookie só viaja para as
 * rotas de sessão (Path) e só em requisição do mesmo site (SameSite=Strict):
 * a PWA (homolog.quironequi.com.br) e a API (api-homolog.quironequi.com.br)
 * são o mesmo site, então o fetch com `credentials: 'include'` leva o cookie,
 * e um formulário de outro site não leva — é isso que segura o CSRF aqui.
 *
 * Sem Domain: o cookie fica preso ao host da API, não vale para os outros
 * subdomínios.
 */
export const REFRESH_COOKIE = 'qe_refresh';

/**
 * Path como o navegador vê: o BFF tira o /api/v1 antes de repassar ao
 * identity, mas o cookie é casado pela URL pública.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Secure sempre: o Chrome e o Firefox tratam http://localhost como
    // contexto seguro, então o dev local também funciona.
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, refreshToken: string, maxAgeMs: number): void {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(), maxAge: maxAgeMs });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

/**
 * Lê o refresh token do cabeçalho Cookie, sem depender de cookie-parser.
 * Devolve undefined se o cookie não veio ou veio vazio.
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    if (!raw) return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined; // codificação quebrada: tratar como ausente
    }
  }
  return undefined;
}
