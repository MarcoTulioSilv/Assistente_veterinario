'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { hasSession } from '@/lib/api';

/**
 * A raiz nunca teve tela própria — só redireciona pro destino certo
 * conforme sessão. Sem isso, abrir o domínio puro (sem path) dá 404.
 */
export default function RootPage(): null {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasSession() ? '/dashboard' : '/login');
  }, [router]);

  return null;
}
