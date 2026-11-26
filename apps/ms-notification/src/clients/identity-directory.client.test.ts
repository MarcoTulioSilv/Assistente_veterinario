import { describe, it, expect, vi } from 'vitest';
import { IdentityDirectoryClient, DirectoryUnavailableError } from './identity-directory.client';

const TENANT = '11111111-1111-1111-1111-111111111111';
const RECIPIENT = { userId: 'u1', email: 'v@x.com', phone: null, emailVerified: true };

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('IdentityDirectoryClient', () => {
  it('chama a rota interna com o token de serviço', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(200, RECIPIENT));
    const client = new IdentityDirectoryClient('http://ms1:3001', 'segredo', fetchFn);

    expect(await client.byVeterinarian(TENANT, 'v1')).toEqual(RECIPIENT);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`http://ms1:3001/internal/tenants/${TENANT}/recipients/veterinarians/v1`);
    expect(init.headers['x-service-token']).toBe('segredo');
  });

  it('404 = sem destinatário; admins vazios viram lista vazia', async () => {
    const client = new IdentityDirectoryClient('http://ms1', 't', vi.fn().mockResolvedValue(reply(404)));
    expect(await client.byUser(TENANT, 'u1')).toBeNull();
    expect(await client.tenantAdmins(TENANT)).toEqual([]);
  });

  it('5xx, 401 e falha de rede viram erro (o job tenta de novo)', async () => {
    for (const fetchFn of [
      vi.fn().mockResolvedValue(reply(503)),
      vi.fn().mockResolvedValue(reply(401)),
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    ]) {
      await expect(new IdentityDirectoryClient('http://ms1', 't', fetchFn).tenantAdmins(TENANT)).rejects.toBeInstanceOf(
        DirectoryUnavailableError,
      );
    }
  });
});
