'use client';

import { useEffect, useState } from 'react';

/**
 * Registra o Service Worker e avisa quando ha nova versao disponivel.
 * Substitui o `register: true` que o next-pwa fazia automaticamente.
 */
export function ServiceWorkerRegistration(): React.ReactElement | null {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') return;

    let registration: ServiceWorkerRegistration | undefined;

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch((err) => {
        console.error('Falha ao registrar o Service Worker:', err);
      });

    // Verifica atualizacoes a cada hora
    const interval = setInterval(() => void registration?.update(), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-lg bg-slate-800 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span>Nova versão disponível</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-white px-3 py-1 font-medium text-slate-800"
      >
        Atualizar
      </button>
    </div>
  );
}
