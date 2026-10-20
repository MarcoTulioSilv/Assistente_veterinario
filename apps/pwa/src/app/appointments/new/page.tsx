'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Animal, Product } from '@quironequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AppointmentForm } from '../AppointmentForm';
import type { AppointmentFormValues, AppointmentItemFormValues } from '../schema';
import { splitItems } from '../contract-bridge';

function toCreateDto(
  values: AppointmentFormValues,
  items: AppointmentItemFormValues[],
  animal: Animal,
  veterinarianId: string,
) {
  // Ver contract-bridge.ts: procedimento vira texto, valor vai na mão de obra.
  const { products, procedureDescription, procedureCents } = splitItems(items);

  return {
    // Não nulos garantidos: a lista só oferece animais com status 'active'.
    ownerId: animal.ownerId as string,
    propertyId: animal.propertyId as string,
    animalIds: [animal.id],
    veterinarianId,
    type: values.type,
    animalLocation: values.animalLocation || undefined,
    performedAt: new Date(values.performedAt).toISOString(),
    laborCents: (parseBRLToCents(values.laborCents ?? '') ?? 0) + procedureCents,
    procedureDescription,
    displacementKm: parseOptionalNumber(values.displacementKm ?? ''),
    displacementRateCents: parseBRLToCents(values.displacementRateCents ?? ''),
    items: products,
  };
}

export default function NewAppointmentPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [veterinarianId, setVeterinarianId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    Promise.all([
      api.animals.list({ status: 'active', limit: 100 }),
      api.products.list({ limit: 100 }),
      api.tenants.getMe(),
    ])
      .then(([animalsResult, productsResult, profile]) => {
        setAnimals(animalsResult.data);
        setProducts(productsResult.data);
        setVeterinarianId(profile.veterinarian.id);
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
    animalId: string,
  ): Promise<void> {
    const animal = animals.find((a) => a.id === animalId);
    if (!animal || !animal.ownerId || !animal.propertyId || !veterinarianId) {
      toast({
        title: 'Animal sem propriedade/proprietário vinculado',
        description: 'Cadastre isso antes de criar o atendimento.',
        variant: 'error',
      });
      return;
    }

    try {
      const appointment = await api.appointments.create(
        toCreateDto(values, items, animal, veterinarianId),
      );
      toast({ title: 'Atendimento criado', variant: 'success' });
      router.push(`/appointments/${appointment.id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao criar atendimento', description: message, variant: 'error' });
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
          <h1 className="mt-2 text-xl font-bold text-primary-800">Novo atendimento</h1>
        </div>
        <AppointmentForm
          animals={animals}
          products={products}
          onSubmit={handleSubmit}
          submitLabel="Criar atendimento"
          submittingLabel="Criando"
        />
      </div>
    </main>
  );
}
