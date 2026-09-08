/**
 * Detecta o tipo real de imagem pelos bytes do arquivo (magic numbers),
 * nunca pelo Content-Type que o cliente declarou no multipart — esse é
 * só um metadado de texto, qualquer um manda o valor que quiser (renomear
 * um .exe pra foto.png com Content-Type: image/png passa direto por
 * qualquer checagem que confie nele). Apontado em review pelo Marco no
 * PR #14.
 *
 * Cobre só os três formatos que o upload aceita (ver
 * UPLOAD_IMAGE_EXTENSIONS em shared-types) — não é um detector genérico.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
