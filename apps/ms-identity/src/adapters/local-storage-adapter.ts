import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter, UploadedFile } from './storage-adapter';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Implementação real de StorageAdapter — salva em disco local, servido
 * estaticamente por app.ts em /uploads. Substitui um S3StorageAdapter até
 * as credenciais de Storage (M2+, .env.example) existirem; mesma troca de
 * uma linha que NominatimMapsAdapter fez pro MockMapsAdapter.
 *
 * Arquivos ficam sob uploads/<tenantId>/ — isolamento por tenant no
 * filesystem, análogo ao RLS no banco (não é RLS de verdade, é só
 * organização/limpeza; a URL devolvida não exige autenticação pra ler,
 * mesmo padrão de uma imagem pública em qualquer object storage).
 */
export class LocalStorageAdapter implements StorageAdapter {
  async upload(tenantId: string, folder: string, file: UploadedFile): Promise<string> {
    const extension = EXTENSION_BY_MIME_TYPE[file.mimeType];
    if (!extension) {
      throw new Error(`Tipo de arquivo não suportado: ${file.mimeType}`);
    }

    const filename = `${randomUUID()}${extension}`;
    const dir = path.join(UPLOADS_DIR, tenantId, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), file.buffer);

    const publicBaseUrl = process.env['PUBLIC_BFF_URL'] ?? 'http://localhost:3000';
    return `${publicBaseUrl}/api/v1/uploads/${tenantId}/${folder}/${filename}`;
  }
}
