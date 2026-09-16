'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { clearSession } from '@/lib/api';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/owners', label: 'Proprietários' },
  { href: '/properties', label: 'Propriedades' },
  { href: '/animals', label: 'Animais' },
  { href: '/inventory', label: 'Estoque' },
  { href: '/profile', label: 'Meu perfil' },
];

/**
 * Barra de navegação persistente das telas autenticadas. Antes do Dashboard
 * não existia nenhuma — cada tela só linkava pra vizinha mais próxima
 * (Perfil -> Proprietários -> Propriedades -> Animais em fila). Substitui
 * esses back-links ad-hoc nas telas de lista; as de criação/edição (formulário
 * de coluna única) continuam só com "← voltar", nav completa ficaria pesada ali.
 */
export function AppHeader(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout(): void {
    clearSession();
    router.replace('/login');
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  active
                    ? 'bg-primary-50 text-primary-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button type="button" variant="ghost" size="sm" onClick={handleLogout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
