import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalUploadUrl, ownUploadUrl, parseUploadUrl, signUploadUrl, verifyUploadSignature } from './upload-url';

const TENANT = '0f0f0f0f-0000-4000-8000-000000000001';
const OTHER = '0f0f0f0f-0000-4000-8000-000000000002';
const KEY = `${TENANT}/general/abc.png`;
const URL_A = `https://api.exemplo.com/api/v1/uploads/${KEY}`;

beforeAll(() => {
  process.env['JWT_SECRET'] = 'segredo-de-teste-com-mais-de-32-caracteres';
  delete process.env['UPLOAD_URL_SECRET'];
});

function query(url: string): { exp: string | null; sig: string | null } {
  const u = new URL(url);
  return { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
}

describe('URLs assinadas de upload (M-03)', () => {
  it('reconhece só URLs de upload desta API', () => {
    expect(parseUploadUrl(URL_A)).toEqual({ key: KEY, tenantId: TENANT });
    expect(parseUploadUrl('https://cdn.outro.com/logo.png')).toBeNull();
    expect(parseUploadUrl(`https://api.exemplo.com/api/v1/uploads/${TENANT}/general/../x.png`)).toBeNull();
    expect(parseUploadUrl('nem é url')).toBeNull();
  });

  it('assina a URL do próprio tenant, e a assinatura confere dentro do prazo', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const signed = signUploadUrl(URL_A, TENANT, now);
    const { exp, sig } = query(signed);
    expect(Number(exp)).toBe(now.getTime() / 1000 + 15 * 60);
    expect(verifyUploadSignature(KEY, exp, sig, now)).toBe(true);
  });

  it('recusa assinatura vencida, adulterada, de outro arquivo ou ausente', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const { exp, sig } = query(signUploadUrl(URL_A, TENANT, now));
    expect(verifyUploadSignature(KEY, exp, sig, new Date(now.getTime() + 16 * 60_000))).toBe(false);
    expect(verifyUploadSignature(KEY, String(Number(exp) + 3600), sig, now)).toBe(false); // prazo esticado
    expect(verifyUploadSignature(`${TENANT}/general/outro.png`, exp, sig, now)).toBe(false);
    expect(verifyUploadSignature(KEY, undefined, undefined, now)).toBe(false);
    expect(verifyUploadSignature(KEY, ['1'], sig, now)).toBe(false);
  });

  it('não assina arquivo de outro tenant (devolve sem assinatura, que não abre)', () => {
    const signed = signUploadUrl(URL_A, OTHER);
    expect(signed).toBe(URL_A);
  });

  it('URL externa e nulo passam como vieram', () => {
    expect(signUploadUrl('https://cdn.outro.com/logo.png', TENANT)).toBe('https://cdn.outro.com/logo.png');
    expect(signUploadUrl(null, TENANT)).toBeNull();
  });

  it('para gravar: tira a assinatura e recusa arquivo de outro tenant', () => {
    const signed = signUploadUrl(URL_A, TENANT);
    expect(canonicalUploadUrl(signed, TENANT)).toBe(URL_A);
    expect(canonicalUploadUrl(URL_A, OTHER)).toBeNull();
    expect(ownUploadUrl(signed, TENANT, 'photoUrl')).toBe(URL_A);
    expect(ownUploadUrl(undefined, TENANT, 'photoUrl')).toBeUndefined();
    expect(ownUploadUrl(null, TENANT, 'photoUrl')).toBeNull();
    expect(() => ownUploadUrl(URL_A, OTHER, 'photoUrl')).toThrow(/não pertence a esta clínica/);
  });

  it('UPLOAD_URL_SECRET próprio muda a assinatura (não reaproveita a derivada do JWT)', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const derived = query(signUploadUrl(URL_A, TENANT, now)).sig;
    process.env['UPLOAD_URL_SECRET'] = 'outro-segredo-proprio-com-mais-de-32-caracteres';
    try {
      expect(query(signUploadUrl(URL_A, TENANT, now)).sig).not.toBe(derived);
    } finally {
      delete process.env['UPLOAD_URL_SECRET'];
    }
  });
});
