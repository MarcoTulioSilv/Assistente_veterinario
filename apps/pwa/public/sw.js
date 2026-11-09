/**
 * ══════════════════════════════════════════════════════════════════
 * Quíron Equine — Service Worker
 *
 * Escrito a mao para eliminar a dependencia do Workbox, que arrastava
 * vulnerabilidades via @rollup/plugin-terser -> serialize-javascript (RCE).
 *
 * Estrategias:
 *   - App shell        -> Cache First   (assets estaticos)
 *   - APIs de cadastro -> Network First (RNF-DIS-002: leitura offline)
 *   - Navegacao        -> Network First com fallback para pagina offline
 *
 * Refs: ERS v1.1 RNF-DIS-002, RF-NOT-001 (push)
 * ══════════════════════════════════════════════════════════════════
 */

const VERSION = 'v3'; // v2 -> v3: chave do cache de API passa a levar X-Cache-Scope (auditoria A-01)
const SHELL_CACHE = `quironequine-shell-${VERSION}`;
const API_CACHE = `quironequine-api-${VERSION}`;
const OFFLINE_URL = '/offline';

const SHELL_ASSETS = [
  '/',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const CACHEABLE_API = /\/api\/v1\/(owners|properties|animals|inventory)/;
const API_CACHE_LIMIT = 200;

// ─── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('quironequine-') && !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ─── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  if (CACHEABLE_API.test(url.pathname)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

// ─── Estrategias ──────────────────────────────────────────────────

/**
 * Chave de cache escopada por usuário (auditoria A-01, item "desejável"):
 * api.ts manda X-Cache-Scope: <tenantId>:<userId> em toda chamada. Sem o
 * escopo na chave, dois usuários do mesmo aparelho (ou dois tenants)
 * compartilhariam a mesma entrada pra mesma URL -- o próximo, offline, veria
 * os dados do anterior mesmo com o cache "certo" pra aquela rota. Também
 * fecha a corrida do logout: uma resposta que grava no cache bem depois do
 * clearApiCache() cai no escopo de QUEM fez a chamada (o usuário que saiu),
 * nunca no do próximo que logar -- o escopo dele é outro, nunca bate.
 */
function scopedKey(request) {
  const scope = request.headers.get('X-Cache-Scope');
  return scope ? `${request.url}#scope=${scope}` : request.url;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = scopedKey(request);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      cache.put(key, response.clone());
      void trimCache(cacheName, API_CACHE_LIMIT);
    }
    return response;
  } catch {
    const cached = await cache.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-QuironEquine-From-Cache', 'true');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return new Response(
      JSON.stringify({
        code: 'OFFLINE',
        message: 'Sem conexao e sem dados em cache para esta consulta.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

async function navigationHandler(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline ?? new Response('Offline', { status: 503 });
  }
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

// ─── PUSH (RF-NOT-001) ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Quíron Equine', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Quíron Equine', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
      vibrate: [100, 50, 100],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(target));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
