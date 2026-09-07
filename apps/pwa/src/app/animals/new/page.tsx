'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Owner, Property } from '@vetequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AnimalForm } from '../AnimalForm';
import type { AnimalFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. */
function toCreateDto(values: AnimalFormValues, propertyId: string) {
  return {
    name: values.name,
    species: values.species || undefined,
    sex: values.sex || undefined,
    breed: values.breed || undefined,
    coat: values.coat || undefined,
    birthDate: values.birthDate || undefined,
    castrated: values.castrated,
    photoUrl: values.photoUrl || undefined,
    sketchUrl: values.sketchUrl || undefined,
    ownerId: values.ownerId || undefined,
    propertyId: propertyId || undefined,
  };
}

export default function NewAnimalPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    setReady(true);
    Promise.all([
      api.owners.list({ status: 'all', limit: 100 }),
      api.properties.list({ status: 'all', limit: 100 }),
    ])
      .then(([ownersResult, propertiesResult]) => {
        setOwners(ownersResult.data);
        setProperties(propertiesResult.data);
      })
      .catch(() => undefined); // listas de vínculo são auxiliares — falha aqui não impede o cadastro
  }, [router]);

  async function handleSubmit(values: AnimalFormValues, propertyId: string): Promise<void> {
    try {
      const animal = await api.animals.create(toCreateDto(values, propertyId));
      toast({ title: 'Animal cadastrado', variant: 'success' });
      router.push(`/animals/${animal.id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao cadastrar', description: message, variant: 'error' });
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
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href="/animals" className="text-sm text-primary-700 hover:underline">
            &larr; Animais
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Novo animal</h1>
        </div>
        <AnimalForm
          owners={owners}
          properties={properties}
          onSubmit={handleSubmit}
          submitLabel="Cadastrar"
          submittingLabel="Cadastrando"
        />
      </div>
    </main>
  );
}
