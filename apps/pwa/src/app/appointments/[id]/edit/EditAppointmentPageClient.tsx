'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  Animal,
  Appointment,
  Product,
  Property,
  UpdateAppointmentDto,
} from '@quironequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { centsToBRLInput, parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AppointmentForm } from '../../AppointmentForm';
import type { AnimalClinicalFormValues, AppointmentFormValues, AppointmentItemFormValues } from '../../schema';

/** 2026-10-05T12:00:00.000Z -> "2026-10-05T09:00" no fuso local, pro <input type="datetime-local">. */
function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toDefaultValues(appointment: Appointment): Partial<AppointmentFormValues> {
  return {
    title: appointment.title,
    type: appointment.type,
    performedAt: toDatetimeLocal(appointment.performedAt),
    animalLocation: appointment.animalLocation ?? '',
    procedureDescription: appointment.procedureDescription ?? '',
    laborCents: centsToBRLInput(appointment.laborCents),
    displacementKm: appointment.displacementKm === 0 ? '' : String(appointment.displacementKm),
    displacementRateCents: centsToBRLInput(appointment.displacementRateCents),
  };
}

function toDefaultItems(appointment: Appointment): AppointmentItemFormValues[] {
  return appointment.items.map((item) => ({
    productId: item.productId,
    description: item.description,
    quantity: String(item.quantity),
    unitPriceCents: centsToBRLInput(item.unitPriceCents),
  }));
}

function toDefaultClinical(appointment: Appointment): Record<string, AnimalClinicalFormValues> {
  return Object.fromEntries(
    appointment.animals.map((a) => [
      a.animalId,
      {
        medicalRecord: {
          anamnesis: a.medicalRecord?.anamnesis ?? '',
          diagnosis: a.medicalRecord?.diagnosis ?? '',
          treatment: a.medicalRecord?.treatment ?? '',
          prognosis: a.medicalRecord?.prognosis ?? '',
          referral: a.medicalRecord?.referral ?? '',
        },
        prescriptions: a.prescriptions.map((p) => ({
          productId: p.productId ?? '',
          medicationName: p.medicationName,
          dose: p.dose,
          route: p.route,
          schedule: p.schedule,
          applicationSite: p.applicationSite ?? '',
          notes: p.notes ?? '',
        })),
      },
    ]),
  );
}

function toUpdateDto(
  values: AppointmentFormValues,
  items: AppointmentItemFormValues[],
  propertyId: string,
  animalIds: string[],
  clinical: Record<string, AnimalClinicalFormValues>,
  location: { latitude: number; longitude: number } | null,
): UpdateAppointmentDto {
  return {
    propertyId,
    animalIds,
    type: values.type,
    title: values.title || undefined,
    animalLocation: values.animalLocation || undefined,
    locationLatitude: location?.latitude,
    locationLongitude: location?.longitude,
    performedAt: new Date(values.performedAt).toISOString(),
    procedureDescription: values.procedureDescription || undefined,
    laborCents: parseBRLToCents(values.laborCents ?? '') ?? 0,
    displacementKm: parseOptionalNumber(values.displacementKm ?? '') ?? 0,
    displacementRateCents: parseBRLToCents(values.displacementRateCents ?? '') ?? 0,
    items: items.map((item) => ({
      productId: item.productId,
      description: item.description,
      quantity: parseOptionalNumber(item.quantity) ?? 1,
      unitPriceCents: parseBRLToCents(item.unitPriceCents) ?? 0,
    })),
    clinical: Object.entries(clinical).map(([animalId, entry]) => ({
      animalId,
      medicalRecord: {
        anamnesis: entry.medicalRecord.anamnesis || undefined,
        diagnosis: entry.medicalRecord.diagnosis || undefined,
        treatment: entry.medicalRecord.treatment || undefined,
        prognosis: entry.medicalRecord.prognosis || undefined,
        referral: entry.medicalRecord.referral || undefined,
      },
      prescriptions: entry.prescriptions.map((p) => ({
        productId: p.productId || null,
        medicationName: p.medicationName,
        dose: p.dose,
        route: p.route,
        schedule: p.schedule,
        applicationSite: p.applicationSite || undefined,
        notes: p.notes || undefined,
      })),
    })),
  };
}

export function EditAppointmentPageClient(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
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
            title: 'Este orçamento não pode mais ser editado',
            description: 'O orçamento fica congelado depois de finalizado.',
            variant: 'error',
          });
          router.replace(`/appointments/${id}`);
          return;
        }
        const [propertiesResult, animalsResult, productsResult] = await Promise.all([
          api.properties.list({ status: 'active', limit: 100 }),
          api.animals.list({ status: 'active', limit: 100 }),
          api.products.list({ limit: 100 }),
        ]);
        if (cancelled) return;
        setAppointment(data);
        setProperties(propertiesResult.data);
        setAnimals(animalsResult.data);
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
        toast({ title: 'Falha ao carregar orçamento', variant: 'error' });
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
    propertyId: string,
    animalIds: string[],
    clinical: Record<string, AnimalClinicalFormValues>,
    location: { latitude: number; longitude: number } | null,
  ): Promise<void> {
    if (!appointment) return;

    // O proprietário da pendência não muda nesta tela (UpdateAppointmentDto
    // nem aceita ownerId) — bloqueia se os animais escolhidos agora forem de
    // outro proprietário, pra não deixar a pendência atribuída errado.
    const selected = animals.filter((a) => animalIds.includes(a.id));
    const wrongOwner = selected.some((a) => a.ownerId !== appointment.ownerId);
    if (wrongOwner) {
      toast({
        title: 'Animal de outro proprietário',
        description: 'Este orçamento já pertence a um proprietário — crie um novo orçamento pra outro.',
        variant: 'error',
      });
      return;
    }

    try {
      await api.appointments.update(id, toUpdateDto(values, items, propertyId, animalIds, clinical, location));
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

  if (notFound || !appointment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Orçamento não encontrado</h1>
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
          <h1 className="mt-2 text-xl font-bold text-primary-800">Editar orçamento</h1>
        </div>
        <AppointmentForm
          defaultValues={toDefaultValues(appointment)}
          defaultPropertyId={appointment.propertyId}
          defaultAnimalIds={appointment.animals.map((a) => a.animalId)}
          defaultItems={toDefaultItems(appointment)}
          defaultClinical={toDefaultClinical(appointment)}
          defaultLocation={
            appointment.locationLatitude !== null && appointment.locationLongitude !== null
              ? { latitude: appointment.locationLatitude, longitude: appointment.locationLongitude }
              : null
          }
          properties={properties}
          animals={animals}
          products={products}
          onSubmit={handleSubmit}
          submitLabel="Salvar alterações"
          submittingLabel="Salvando"
        />
      </div>
    </main>
  );
}
