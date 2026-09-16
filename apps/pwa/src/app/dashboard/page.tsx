'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TenantProfile } from '@vetequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { cn } from '@/lib/cn';
import { api, ApiClientError, hasSession } from '@/lib/api';

interface SectionCounts {
  active: number;
  pending: number;
}

interface InventoryCounts {
  total: number;
  alerts: number;
}

interface DashboardCounts {
  owners: SectionCounts;
  properties: SectionCounts;
  animals: SectionCounts;
  inventory: InventoryCounts;
}

const SECTIONS: {
  key: Exclude<keyof DashboardCounts, 'inventory'>;
  title: string;
  href: string;
  newHref: string;
  newLabel: string;
  activeLabel: string;
  pendingLabel: string;
}[] = [
  {
    key: 'owners',
    title: 'Proprietários',
    href: '/owners',
    newHref: '/owners/new',
    newLabel: 'Novo proprietário',
    activeLabel: 'ativos',
    pendingLabel: 'pendentes',
  },
  {
    key: 'properties',
    title: 'Propriedades',
    href: '/properties',
    newHref: '/properties/new',
    newLabel: 'Nova propriedade',
    activeLabel: 'ativas',
    pendingLabel: 'pendentes',
  },
  {
    key: 'animals',
    title: 'Animais',
    href: '/animals',
    newHref: '/animals/new',
    newLabel: 'Novo animal',
    activeLabel: 'ativos',
    pendingLabel: 'pendentes',
  },
];

export default function DashboardPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    setReady(true);

    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const [
          profileResult,
          ownersActive,
          ownersPending,
          propertiesActive,
          propertiesPending,
          animalsActive,
          animalsPending,
          products,
        ] = await Promise.all([
          api.tenants.getMe(),
          api.owners.list({ page: 1, limit: 1, status: 'active' }),
          api.owners.list({ page: 1, limit: 1, status: 'pending' }),
          api.properties.list({ page: 1, limit: 1, status: 'active' }),
          api.properties.list({ page: 1, limit: 1, status: 'pending' }),
          api.animals.list({ page: 1, limit: 1, status: 'active' }),
          api.animals.list({ page: 1, limit: 1, status: 'pending' }),
          // Sem endpoint de contagem de alertas -- lê a 1ª página (limite do plano
          // Básico é pequeno) e conta localmente; produtos em alerta além dela não entram.
          api.products.list({ page: 1, limit: 100 }),
        ]);

        if (cancelled) return;
        setProfile(profileResult);
        setCounts({
          owners: {
            active: ownersActive.pagination.total,
            pending: ownersPending.pagination.total,
          },
          properties: {
            active: propertiesActive.pagination.total,
            pending: propertiesPending.pagination.total,
          },
          animals: {
            active: animalsActive.pagination.total,
            pending: animalsPending.pagination.total,
          },
          inventory: {
            total: products.pagination.total,
            alerts: products.data.filter((p) => p.isLowStock || p.isNearExpiry).length,
          },
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        toast({ title: 'Falha ao carregar o dashboard', variant: 'error' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="min-h-screen bg-slate-50 p-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-primary-800">
              {profile ? `Olá, ${profile.veterinarian.fullName.split(' ')[0]}` : 'Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {profile?.tenantName ?? 'Visão geral da clínica'}
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center p-10">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SECTIONS.map((section) => {
                const count = counts?.[section.key];
                return (
                  <div
                    key={section.key}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <Link href={section.href} className="group">
                      <p className="text-sm font-medium text-slate-500 group-hover:text-primary-700">
                        {section.title}
                      </p>
                      <p className="mt-1 text-3xl font-bold text-primary-800">
                        {count?.active ?? 0}
                      </p>
                      <p className="text-sm text-slate-500">{section.activeLabel}</p>
                    </Link>
                    {!!count?.pending && (
                      <Link
                        href={section.href}
                        className={cn(
                          'inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          'bg-amber-100 text-amber-800 hover:bg-amber-200',
                        )}
                      >
                        {count.pending} {section.pendingLabel}
                      </Link>
                    )}
                    <Link
                      href={section.newHref}
                      className="mt-auto text-sm text-primary-700 hover:underline"
                    >
                      + {section.newLabel}
                    </Link>
                  </div>
                );
              })}
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <Link href="/inventory" className="group">
                  <p className="text-sm font-medium text-slate-500 group-hover:text-primary-700">Estoque</p>
                  <p className="mt-1 text-3xl font-bold text-primary-800">{counts?.inventory.total ?? 0}</p>
                  <p className="text-sm text-slate-500">produtos</p>
                </Link>
                {!!counts?.inventory.alerts && (
                  <Link
                    href="/inventory"
                    className={cn(
                      'inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      'bg-red-100 text-red-800 hover:bg-red-200',
                    )}
                  >
                    {counts.inventory.alerts} em alerta
                  </Link>
                )}
                <Link href="/inventory/new" className="mt-auto text-sm text-primary-700 hover:underline">
                  + Novo produto
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
