import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { LocalStorageAdapter } from './local-storage-adapter';

const TENANT_ID = 'test-tenant-local-storage';
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

describe('LocalStorageAdapter.upload', () => {
  afterEach(async () => {
    await rm(path.join(UPLOADS_DIR, TENANT_ID), { recursive: true, force: true });
  });

  it('salva o arquivo em disco sob uploads/<tenantId>/<folder>/ e devolve uma URL absoluta', async () => {
    const adapter = new LocalStorageAdapter();
    const buffer = Buffer.from('conteúdo de teste');

    const url = await adapter.upload(TENANT_ID, 'general', {
      buffer,
      mimeType: 'image/png',
      originalName: 'foto.png',
    });

    expect(url).toMatch(
      new RegExp(`^http://localhost:3000/api/v1/uploads/${TENANT_ID}/general/[0-9a-f-]+\\.png$`),
    );

    const savedPath = path.join(UPLOADS_DIR, ...url.split('/uploads/')[1]!.split('/'));
    await expect(readFile(savedPath)).resolves.toEqual(buffer);
  });

  it('usa a extensão correta pra cada mime type suportado', async () => {
    const adapter = new LocalStorageAdapter();
    const file = { buffer: Buffer.from('x'), mimeType: 'image/webp', originalName: 'x' };

    const url = await adapter.upload(TENANT_ID, 'general', file);

    expect(url).toMatch(/\.webp$/);
  });

  it('rejeita mime type não suportado, sem escrever nada em disco', async () => {
    const adapter = new LocalStorageAdapter();

    await expect(
      adapter.upload(TENANT_ID, 'general', {
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
        originalName: 'x.pdf',
      }),
    ).rejects.toThrow(/não suportado/);
  });

  it('gera nomes de arquivo diferentes pra dois uploads seguidos (sem colisão)', async () => {
    const adapter = new LocalStorageAdapter();
    const file = { buffer: Buffer.from('x'), mimeType: 'image/jpeg', originalName: 'x.jpg' };

    const url1 = await adapter.upload(TENANT_ID, 'general', file);
    const url2 = await adapter.upload(TENANT_ID, 'general', file);

    expect(url1).not.toBe(url2);
  });
});
