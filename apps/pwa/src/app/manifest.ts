import type { MetadataRoute } from 'next';

/**
 * Manifest nativo do App Router — substitui public/manifest.json.
 * Tipado, sem arquivo estatico. Servido em /manifest.webmanifest.
 *
 * `dynamic = 'force-static'`: por baixo dos panos isto vira um Route
 * Handler, que por padrão é dinâmico — incompatível com output:'export'
 * (build estático pro GitHub Pages, ver next.config.ts).
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Quíron Equine — Gestão Veterinária Equina',
    short_name: 'Quíron Equine',
    description: 'Sistema de gestão clínica e administrativa para veterinários equinos',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1A3A5C',
    lang: 'pt-BR',
    categories: ['medical', 'productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
