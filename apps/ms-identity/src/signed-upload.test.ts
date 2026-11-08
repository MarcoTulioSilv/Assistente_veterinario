import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signUploadUrl } from '@quironequine/shared-middlewares';
import { createApp } from './app';

/**
 * Leitura de arquivos só com URL assinada (auditoria M-03). Sobe o app de
 * verdade e um arquivo de verdade em uploads/<tenant>/; não toca no banco.
 */
const TENANT = 'f11e0000-0000-4000-8000-000000000001';
const DIR = path.join(__dirname, '../uploads', TENANT);
const KEY = `${TENANT}/general/teste.png`;

let server: Server;
let base: string;

beforeAll(async () => {
  process.env['JWT_SECRET'] ??= 'segredo-de-teste-com-mais-de-32-caracteres';
  await mkdir(path.join(DIR, 'general'), { recursive: true });
  await writeFile(path.join(DIR, 'general', 'teste.png'), Buffer.from('conteúdo do laudo'));
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(DIR, { recursive: true, force: true });
});

/** O que o BFF repassa: /api/v1/uploads/... vira /uploads/... */
function local(signedUrl: string): string {
  const u = new URL(signedUrl);
  return `${base}${u.pathname.replace('/api/v1', '')}${u.search}`;
}

const publicUrl = `https://api.exemplo.com/api/v1/uploads/${KEY}`;

describe('GET /uploads — só com URL assinada (M-03)', () => {
  it('com assinatura válida: entrega o arquivo, sem cache compartilhado', async () => {
    const res = await fetch(local(signUploadUrl(publicUrl, TENANT)));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('conteúdo do laudo');
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sem assinatura (a URL antiga, vazada no WhatsApp): 404', async () => {
    const res = await fetch(`${base}/uploads/${KEY}`);
    expect(res.status).toBe(404);
  });

  it('assinatura de outro arquivo ou vencida: 404', async () => {
    const outro = new URL(signUploadUrl(publicUrl.replace('teste.png', 'outro.png'), TENANT));
    const res1 = await fetch(`${base}/uploads/${KEY}${outro.search}`);
    expect(res1.status).toBe(404);

    const vencida = signUploadUrl(publicUrl, TENANT, new Date(Date.now() - 60 * 60_000));
    expect((await fetch(local(vencida))).status).toBe(404);
  });

  it('caminho que tenta subir de diretório: 404', async () => {
    const res = await fetch(`${base}/uploads/${TENANT}/general/..%2F..%2Fpackage.json?exp=9999999999&sig=x`);
    expect(res.status).toBe(404);
  });

  it('POST /uploads continua indo para o envio (exige login: 401, não 404)', async () => {
    const res = await fetch(`${base}/uploads`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
