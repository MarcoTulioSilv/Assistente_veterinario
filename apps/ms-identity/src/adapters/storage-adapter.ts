/**
 * Integração externa — Dev 2 é o dono (ADR-001 §8.2, "adapters/").
 * Mesmo padrão do MapsAdapter (ver adapters/maps-adapter.ts): a interface é
 * publicada aqui, LocalStorageAdapter é a implementação real de hoje, e um
 * S3StorageAdapter (variáveis S3_* já reservadas em .env.example, "Storage
 * M2+") é uma troca de uma linha na injeção quando as credenciais existirem.
 */
export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface StorageAdapter {
  /** Salva o arquivo e devolve a URL pública e absoluta de acesso. */
  upload(tenantId: string, folder: string, file: UploadedFile): Promise<string>;
}
