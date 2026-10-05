'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Appointment, Pagination } from '@quironequine/shared-types';
import { Button, Spinner, useToast } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { cn } from '@/lib/cn';
import { formatCentsToBRL } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';

const TYPE_LABELS: Record<Appointment['type'], string> = {
  clinico_geral: 'Clínico geral',
  reproducao: 'Reprodução',
  odontologico: 'Odontológico',
  locomotor: 'Locomotor',
  cirurgia: 'Cirurgia',
};

const STATUS_LABELS: Record<Appointment['status'], string> = {
  draft: 'Rascunho',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
};

export default function AppointmentsPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!hasSession()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    if (!hasSession()) return;

    let cancelled = false;
    setLoading(true);
    api.appointments
      .list({ page })
      .then((result) => {
        if (cancelled) return;
        setAppointments(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        toast({ title: 'Falha ao carregar atendimentos', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <>
      <AppHeader />
      <main className="min-h-screen bg-slate-50 p-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary-800">Atendimentos</h1>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <div className="flex justify-center p-10">
                <Spinner size="lg" />
              </div>
            ) : appointments.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">Nenhum atendimento encontrado.</p>
            ) : (
              <ul>
                {appointments.map((appointment, index) => (
                  <li key={appointment.id} className={cn(index > 0 && 'border-t border-slate-200')}>
                    <Link
                      href={`/appointments/${appointment.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {TYPE_LABELS[appointment.type]}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {new Date(appointment.performedAt).toLocaleDateString('pt-BR')} ·{' '}
                          {formatCentsToBRL(appointment.totalCents)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          appointment.status === 'finished'
                            ? 'bg-emerald-100 text-emerald-800'
                            : appointment.status === 'cancelled'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {STATUS_LABELS[appointment.status]}
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
