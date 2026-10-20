'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Animal, Appointment, Product, UpdateAppointmentDto } from '@quironequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AppointmentForm } from '../../AppointmentForm';
import type { AppointmentFormValues, AppointmentItemFormValues } from '../../schema';

/** 2026-10-05T12:00:00.000Z -> "2026-10-05T09:00" no fuso local, pro <input type="datetime-local">. */
function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function centsToBRLInput(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

function toDefaultValues(appointment: Appointment): Partial<AppointmentFormValues> {
  return {
    type: appointment.type,
    performedAt: toDatetimeLocal(appointment.performedAt),
    animalLocation: appointment.animalLocation ?? '',
    laborCents: centsToBRLInput(appointment.laborCents),
    displacementKm: appointment.displacementKm === 0 ? '' : String(appointment.displacementKm),
    displacementRateCents: centsToBRLInput(appointment.displacementRateCents),
  };
}

function toDefaultItems(appointment: Appointment): AppointmentItemFormValues[] {
  return appointment.items.map((item) => ({
    kind: item.kind,
    productId: item.productId ?? '',
    description: item.description,
    quantity: String(item.quantity),
    unitPriceCents: centsToBRLInput(item.unitPriceCents),
  }));
}

function toUpdateDto(
  values: AppointmentFormValues,
  items: AppointmentItemFormValues[],
): UpdateAppointmentDto {
  return {
    type: values.type,
    animalLocation: values.animalLocation || undefined,
    performedAt: new Date(values.performedAt).toISOString(),
    laborCents: parseBRLToCents(values.laborCents ?? '') ?? 0,
    displacementKm: parseOptionalNumber(values.displacementKm ?? '') ?? 0,
    displacementRateCents: parseBRLToCents(values.displacementRateCents ?? '') ?? 0,
    items: items.map((item) => ({
      kind: item.kind,
      productId: item.kind === 'product' ? item.productId || undefined : undefined,
      description: item.description,
      quantity: parseOptionalNumber(item.quantity) ?? 1,
      unitPriceCents: parseBRLToCents(item.unitPriceCents) ?? 0,
    })),
  };
}

export default function EditAppointmentPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.appointments
      .get(id)
      .then(async (data) => {
        if (cancelled) return;
        // RF-ATD-006: orçamento só é mutável em rascunho — o próprio backend
        // recusa o PATCH depois de finalizado (requireDraft), então nem
        // oferece o form aqui.
        if (data.status !== 'draft') {
          toast({
            title: 'Este atendimento não pode mais ser editado',
            description: 'O orçamento fica congelado depois de finalizado.',
            variant: 'error',
          });
          router.replace(`/appointments/${id}`);
          return;
        }
        const [animalResult, productsResult] = await Promise.all([
          api.animals.get(data.animalId),
          api.products.list({ limit: 100 }),
        ]);
        if (cancelled) return;
        setAppointment(data);
        setAnimal(animalResult);
        setProducts(productsResult.data);
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

  async function handleSubmit(
    values: AppointmentFormValues,
    items: AppointmentItemFormValues[],
  ): Promise<void> {
    try {
      await api.appointments.update(id, toUpdateDto(values, items));
      toast({ title: 'Alterações salvas', variant: 'success' });
      router.push(`/appointments/${id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  if (notFound || !appointment || !animal) {
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
    <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href={`/appointments/${id}`} className="text-sm text-primary-700 hover:underline">
            &larr; Voltar
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Editar atendimento</h1>
        </div>
        <AppointmentForm
          defaultValues={toDefaultValues(appointment)}
          defaultItems={toDefaultItems(appointment)}
          animals={[animal]}
          animalId={animal.id}
          lockAnimal
          products={products}
          onSubmit={handleSubmit}
          submitLabel="Salvar alterações"
          submittingLabel="Salvando"
        />
      </div>
    </main>
  );
}
