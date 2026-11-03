'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Animal, Product, Property, CreateAppointmentDto } from '@quironequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { centsToBRLInput, parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AppointmentForm } from '../AppointmentForm';
import type { AnimalClinicalFormValues, AppointmentFormValues, AppointmentItemFormValues } from '../schema';

function toCreateDto(
  values: AppointmentFormValues,
  items: AppointmentItemFormValues[],
  ownerId: string,
  propertyId: string,
  animalIds: string[],
  veterinarianId: string,
  clinical: Record<string, AnimalClinicalFormValues>,
  location: { latitude: number; longitude: number } | null,
): CreateAppointmentDto {
  return {
    ownerId,
    propertyId,
    animalIds,
    veterinarianId,
    type: values.type,
    title: values.title || undefined,
    animalLocation: values.animalLocation || undefined,
    locationLatitude: location?.latitude,
    locationLongitude: location?.longitude,
    performedAt: new Date(values.performedAt).toISOString(),
    procedureDescription: values.procedureDescription || undefined,
    laborCents: parseBRLToCents(values.laborCents ?? ''),
    displacementKm: parseOptionalNumber(values.displacementKm ?? ''),
    displacementRateCents: parseBRLToCents(values.displacementRateCents ?? ''),
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

export default function NewAppointmentPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [veterinarianId, setVeterinarianId] = useState<string | null>(null);
  const [displacementRateCents, setDisplacementRateCents] = useState('');

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    Promise.all([
      api.properties.list({ status: 'active', limit: 100 }),
      api.animals.list({ status: 'active', limit: 100 }),
      api.products.list({ limit: 100 }),
      api.tenants.getMe(),
    ])
      .then(([propertiesResult, animalsResult, productsResult, profile]) => {
        setProperties(propertiesResult.data);
        setAnimals(animalsResult.data);
        setProducts(productsResult.data);
        setVeterinarianId(profile.veterinarian.id);
        // Reunião 2026-11-03: valor por km do perfil pré-preenche o orçamento
        // (cópia própria dele, editável — não lê o perfil de novo na exibição).
        if (profile.veterinarian.displacementRateCents !== null) {
          setDisplacementRateCents(centsToBRLInput(profile.veterinarian.displacementRateCents));
        }
        setReady(true);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        toast({ title: 'Falha ao carregar dados do cadastro', variant: 'error' });
      });
  }, [router]);

  async function handleSubmit(
    values: AppointmentFormValues,
    items: AppointmentItemFormValues[],
    propertyId: string,
    animalIds: string[],
    clinical: Record<string, AnimalClinicalFormValues>,
    location: { latitude: number; longitude: number } | null,
  ): Promise<void> {
    const selected = animals.filter((a) => animalIds.includes(a.id));
    const ownerIds = new Set(selected.map((a) => a.ownerId).filter((id): id is string => !!id));
    if (ownerIds.size !== 1 || !veterinarianId) {
      toast({
        title: ownerIds.size > 1 ? 'Os animais escolhidos têm proprietários diferentes' : 'Animal sem proprietário vinculado',
        description: ownerIds.size > 1 ? 'Crie um orçamento separado para cada proprietário.' : 'Cadastre isso antes de criar o orçamento.',
        variant: 'error',
      });
      return;
    }
    const [ownerId] = ownerIds;

    try {
      const appointment = await api.appointments.create(
        toCreateDto(values, items, ownerId!, propertyId, animalIds, veterinarianId, clinical, location),
      );
      toast({ title: 'Orçamento criado', variant: 'success' });
      router.push(`/appointments/${appointment.id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao criar orçamento', description: message, variant: 'error' });
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href="/appointments" className="text-sm text-primary-700 hover:underline">
            &larr; Atendimentos
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Novo orçamento</h1>
        </div>
        <AppointmentForm
          properties={properties}
          animals={animals}
          products={products}
          defaultValues={{ displacementRateCents }}
          onSubmit={handleSubmit}
          submitLabel="Criar orçamento"
          submittingLabel="Criando"
        />
      </div>
    </main>
  );
}
