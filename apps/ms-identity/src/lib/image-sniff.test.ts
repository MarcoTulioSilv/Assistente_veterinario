import { describe, it, expect } from 'vitest';
import { sniffImageMimeType } from './image-sniff';

// PNG mínimo válido (1x1 pixel) -- mesmo fixture usado no smoke test manual.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const REAL_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const REAL_WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);

describe('sniffImageMimeType', () => {
  it('reconhece um PNG de verdade pelos magic bytes', () => {
    expect(sniffImageMimeType(REAL_PNG)).toBe('image/png');
  });

  it('reconhece um JPEG de verdade pelos magic bytes', () => {
    expect(sniffImageMimeType(REAL_JPEG)).toBe('image/jpeg');
  });

  it('reconhece um WebP de verdade pelos magic bytes (RIFF....WEBP)', () => {
    expect(sniffImageMimeType(REAL_WEBP)).toBe('image/webp');
  });

  it('rejeita um arquivo de texto disfarçado de imagem (Content-Type mentiria, os bytes não)', () => {
    const fakeImage = Buffer.from('isto não é uma imagem, é só texto');
    expect(sniffImageMimeType(fakeImage)).toBeNull();
  });

  it('rejeita um executável ELF renomeado pra .png', () => {
    const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
    expect(sniffImageMimeType(elfHeader)).toBeNull();
  });

  it('rejeita buffer vazio ou curto demais pra ter uma assinatura válida', () => {
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('não confunde um WebP com um RIFF de outro tipo (ex: WAV)', () => {
    const fakeWav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(sniffImageMimeType(fakeWav)).toBeNull();
  });
});
