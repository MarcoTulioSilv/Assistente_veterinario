'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Pagination, Product, ProductCategory } from '@vetequine/shared-types';
import { Button, Input, Spinner, useToast } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { cn } from '@/lib/cn';
import { formatCentsToBRL } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';

type CategoryFilter = ProductCategory | 'all';

const CATEGORY_TABS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'medication', label: 'Medicamentos' },
  { value: 'vaccine', label: 'Vacinas' },
  { value: 'supply', label: 'Insumos' },
];

export default function InventoryPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!hasSession()) router.replace('/login');
  }, [router]);

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
    api.products
      .list({ page, search: search || undefined, category: category === 'all' ? undefined : category })
      .then((result) => {
        if (cancelled) return;
        setProducts(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        toast({ title: 'Falha ao carregar o estoque', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, search, category]);

  return (
    <>
      <AppHeader />
      <main className="min-h-screen bg-slate-50 p-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary-800">Estoque</h1>
            <Button onClick={() => router.push('/inventory/new')}>Novo produto</Button>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              label="Buscar"
              placeholder="Nome do produto"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex flex-wrap gap-2">
              {CATEGORY_TABS.map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  size="sm"
                  variant={category === tab.value ? 'primary' : 'outline'}
                  onClick={() => {
                    setCategory(tab.value);
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
            ) : products.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhum produto encontrado{search ? ` para "${search}"` : ''}.
              </p>
            ) : (
              <ul>
                {products.map((product, index) => (
                  <li key={product.id} className={cn(index > 0 && 'border-t border-slate-200')}>
                    <Link
                      href={`/inventory/${product.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{product.name}</p>
                        <p className="truncate text-sm text-slate-500">
                          {product.quantityInStock} {product.unit} em estoque ·{' '}
                          {formatCentsToBRL(product.salePriceCents)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {product.isLowStock && (
                          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                            Baixo estoque
                          </span>
                        )}
                        {product.isNearExpiry && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                            Vencendo
                          </span>
                        )}
                      </div>
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
