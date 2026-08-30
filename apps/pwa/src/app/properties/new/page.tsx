'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Owner } from '@vetequine/shared-types';
import { useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { PropertyForm } from '../PropertyForm';
import type { PropertyFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. */
function toCreateDto(values: PropertyFormValues, ownerIds: string[]) {
  return {
    name: values.name,
    address: values.address || undefined,
    city: values.city || undefined,
    state: values.state || undefined,
    zipCode: values.zipCode || undefined,
    ownerIds: ownerIds.length > 0 ? ownerIds : undefined,
  };
}

export default function NewPropertyPage(): React.ReactElement | null {
  const router = useRouter();
  const { toast } = useToast();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    api.owners
      .list({ status: 'all', limit: 100 })
      .then((result) => setOwners(result.data))
      .catch(() => undefined); // lista de vínculo é auxiliar — falha aqui não impede o cadastro
  }, [router]);

  if (!hasSession()) return null;

  function toggleOwner(id: string): void {
    setOwnerIds((current) => (current.includes(id) ? current.filter((o) => o !== id) : [...current, id]));
  }

  async function handleSubmit(values: PropertyFormValues): Promise<void> {
    try {
      const property = await api.properties.create(toCreateDto(values, ownerIds));
      toast({ title: 'Propriedade cadastrada', variant: 'success' });
      router.push(`/properties/${property.id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao cadastrar', description: message, variant: 'error' });
    }
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href="/properties" className="text-sm text-primary-700 hover:underline">
            &larr; Propriedades
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Nova propriedade</h1>
        </div>
        <PropertyForm onSubmit={handleSubmit} submitLabel="Cadastrar" submittingLabel="Cadastrando">
          {owners.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Proprietários vinculados</span>
              <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border border-slate-300 p-2.5">
                {owners.map((owner) => (
                  <label key={owner.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={ownerIds.includes(owner.id)}
                      onChange={() => toggleOwner(owner.id)}
                      className="h-4 w-4 rounded border-slate-300 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    {owner.fullName}
                  </label>
                ))}
              </div>
              <span className="text-sm text-slate-500">
                Só pode ser definido na criação — não dá pra alterar depois.
              </span>
            </div>
          )}
        </PropertyForm>
      </div>
    </main>
  );
}
