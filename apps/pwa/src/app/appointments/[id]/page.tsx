'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Appointment } from '@quironequine/shared-types';
import { Button, Spinner, useToast } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { formatCentsToBRL } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { TYPE_LABELS, STATUS_LABELS } from '../labels';

/**
 * ATENÇÃO (shared-types `IAppointmentService.softDelete`, decisão do Marco):
 * atendimento finalizado exige pop-up BLOQUEANTE antes de excluir, avisando
 * que a pendência financeira é cancelada, que pagamento já recebido é
 * mantido, e que o estoque consumido não volta. Rascunho (e o status
 * `cancelled`, que nunca chega a gerar cobrança) não precisa do aviso.
 *
 * O findBySource só converte 404 (sem pendência) em `null` — qualquer outro
 * erro (MS6 fora do ar, 5xx, falha de rede) propaga pra cima de propósito:
 * sem saber o estado real da pendência não dá pra montar o aviso correto, e
 * é mais seguro bloquear a exclusão do que arriscar mostrar "será cancelada"
 * quando na verdade ninguém sabe (apontado pelo Marco na review da PR #31 —
 * um .catch(() => null) aqui engolia esse erro e deixava a exclusão passar
 * sem o aviso).
 */
async function buildDeleteWarning(appointment: Appointment): Promise<string> {
  if (appointment.status !== 'finished') {
    return `Remover este atendimento (${STATUS_LABELS[appointment.status].toLowerCase()})? Esta ação não pode ser desfeita por aqui.`;
  }

  const record = await api.financial.findBySource('appointment', appointment.id);

  const paymentLine =
    record?.status === 'received'
      ? '  • O pagamento já registrado para este atendimento será MANTIDO — dinheiro recebido não se apaga.'
      : record?.status === 'cancelled'
        ? '  • A pendência financeira deste atendimento já estava cancelada.'
        : '  • A pendência financeira do proprietário referente a este atendimento será CANCELADA.';

  return [
    'Este atendimento está FINALIZADO. Antes de excluir, atenção:',
    '',
    paymentLine,
    '  • O estoque consumido NÃO volta — os produtos já foram usados no animal.',
    '',
    'Esta ação não pode ser desfeita por aqui. Confirma a exclusão?',
  ].join('\n');
}

export default function AppointmentDetailPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.appointments
      .get(id)
      .then((data) => {
        if (!cancelled) setAppointment(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        if (err instanceof ApiClientError && err.status === 404) {
          setNotFound(true);
          return;
        }
        toast({ title: 'Falha ao carregar atendimento', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete(): Promise<void> {
    if (!appointment) return;

    setDeleting(true);
    // Recarrega antes de decidir o aviso: o status carregado quando a página
    // abriu pode estar desatualizado (ex.: o atendimento foi finalizado em
    // outra aba depois disso) — decidir com o status velho deixaria passar
    // sem o pop-up um atendimento que já é finalizado agora.
    const warning = await api.appointments
      .get(id)
      .then((fresh) => {
        setAppointment(fresh);
        return buildDeleteWarning(fresh);
      })
      .catch(() => {
        // Se nem o aviso carregou (ex.: MS6 fora do ar), é mais seguro bloquear
        // a exclusão do que deixar passar sem o alerta exigido.
        toast({
          title: 'Não foi possível preparar o aviso de exclusão',
          description: 'Tente novamente em alguns instantes.',
          variant: 'error',
        });
        return null;
      });
    setDeleting(false);
    if (warning === null) return;

    if (!window.confirm(warning)) return;

    setDeleting(true);
    try {
      await api.appointments.remove(id);
      toast({ title: 'Atendimento removido', variant: 'success' });
      router.push('/appointments');
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao remover', description: message, variant: 'error' });
      setDeleting(false);
    }
  }

  /**
   * RF-ATD-008: congela o orçamento e publica appointment.done — o MS2 baixa
   * o estoque e o MS6 abre a pendência financeira. Irreversível (não tem
   * "voltar pra rascunho"), por isso o aviso explícito antes de confirmar.
   */
  async function handleFinish(): Promise<void> {
    if (!appointment) return;
    if (
      !window.confirm(
        'Finalizar este atendimento? O orçamento fica congelado, o estoque usado é baixado e uma pendência financeira é aberta para o proprietário. Não é possível desfazer.',
      )
    ) {
      return;
    }

    setFinishing(true);
    try {
      const updated = await api.appointments.finish(id);
      setAppointment(updated);
      toast({ title: 'Atendimento finalizado', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao finalizar', description: message, variant: 'error' });
    } finally {
      setFinishing(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  if (notFound || !appointment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Atendimento não encontrado</h1>
          <Link href="/appointments" className="mt-4 inline-block text-sm text-primary-700 hover:underline">
            Voltar para a lista
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <Link href="/appointments" className="text-sm text-primary-700 hover:underline">
                &larr; Atendimentos
              </Link>
              <h1 className="mt-2 text-xl font-bold text-primary-800">
                {TYPE_LABELS[appointment.type]}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {new Date(appointment.performedAt).toLocaleDateString('pt-BR')} · Status:{' '}
                <strong>{STATUS_LABELS[appointment.status]}</strong>
              </p>
            </div>
            {appointment.status === 'draft' && (
              <Link
                href={`/appointments/${id}/edit`}
                className="shrink-0 text-sm text-primary-700 hover:underline"
              >
                Editar
              </Link>
            )}
          </div>

          <dl className="space-y-3 text-sm">
            {appointment.animalLocation && (
              <div>
                <dt className="text-slate-500">Local do animal</dt>
                <dd className="font-medium text-slate-900">{appointment.animalLocation}</dd>
              </div>
            )}
            <div>
              <dt className="text-slate-500">Itens do orçamento</dt>
              <dd>
                {appointment.items.length === 0 ? (
                  <span className="text-slate-400">Nenhum item</span>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {appointment.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2 text-slate-900">
                        <span className="truncate">
                          {item.quantity}× {item.description}
                        </span>
                        <span className="shrink-0 font-medium">{formatCentsToBRL(item.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold text-primary-800">
              <dt>Total</dt>
              <dd>{formatCentsToBRL(appointment.totalCents)}</dd>
            </div>
          </dl>

          {appointment.status === 'draft' && (
            <Button
              type="button"
              variant="primary"
              loading={finishing}
              onClick={handleFinish}
              className="mt-6 w-full"
            >
              {finishing ? 'Finalizando' : 'Finalizar atendimento'}
            </Button>
          )}

          <Button
            type="button"
            variant="danger"
            loading={deleting}
            onClick={handleDelete}
            className="mt-3 w-full"
          >
            {deleting ? 'Removendo' : 'Remover atendimento'}
          </Button>
        </div>
      </main>
    </>
  );
}
