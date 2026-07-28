import type { NextConfig } from 'next';

/**
 * Config do Next.js 16 — SEM plugin de PWA.
 *
 * Por que removemos @ducanh2912/next-pwa:
 *   1. Arrasta workbox-build -> @rollup/plugin-terser -> serialize-javascript (RCE)
 *   2. O Next 16 usa Turbopack por padrao; Serwist exige Webpack
 *   3. Nossas necessidades de cache sao simples (RNF-DIS-002)
 *
 * O Service Worker e escrito a mao em public/sw.js e registrado
 * pelo componente ServiceWorkerRegistration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@vetequine/shared-types'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self)' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
