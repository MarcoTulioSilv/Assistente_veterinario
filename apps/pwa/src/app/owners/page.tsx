'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Owner, Pagination } from '@vetequine/shared-types';
import { Button, Input, Spinner, useToast } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { cn } from '@/lib/cn';
import { api, ApiClientError, hasSession } from '@/lib/api';

type StatusFilter = 'active' | 'pending' | 'all';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'all', label: 'Todos' },
];

export default function OwnersPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);

  // Redireciona sem sessão.
  useEffect(() => {
    if (!hasSession()) router.replace('/login');
  }, [router]);

  // Debounce da busca — evita uma requisição por tecla digitada.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!hasSession()) return;

    let cancelled = false;
    setLoading(true);
    api.owners
      .list({ page, search: search || undefined, status })
      .then((result) => {
        if (cancelled) return;
        setOwners(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        toast({ title: 'Falha ao carregar proprietários', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, search, status]);

  return (
    <>
      <AppHeader />
      <main className="min-h-screen bg-slate-50 p-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary-800">Proprietários</h1>
            <Button onClick={() => router.push('/owners/new')}>Novo proprietário</Button>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              label="Buscar"
              placeholder="Nome do proprietário"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex gap-2">
              {STATUS_TABS.map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  size="sm"
                  variant={status === tab.value ? 'primary' : 'outline'}
                  onClick={() => {
                    setStatus(tab.value);
                    setPage(1);
                  }}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <div className="flex justify-center p-10">
                <Spinner size="lg" />
              </div>
            ) : owners.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhum proprietário encontrado{search ? ` para "${search}"` : ''}.
              </p>
            ) : (
              <ul>
                {owners.map((owner, index) => (
                  <li key={owner.id} className={cn(index > 0 && 'border-t border-slate-200')}>
                    <Link
                      href={`/owners/${owner.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{owner.fullName}</p>
                        <p className="truncate text-sm text-slate-500">
                          {owner.city && owner.state
                            ? `${owner.city} - ${owner.state}`
                            : owner.phone || 'Sem dados de contato'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          owner.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {owner.status === 'active' ? 'Ativo' : 'Pendente'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span>
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} no total)
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
