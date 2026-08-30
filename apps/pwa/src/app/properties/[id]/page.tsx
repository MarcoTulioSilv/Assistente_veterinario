'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Property } from '@vetequine/shared-types';
import { Button, Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { PropertyForm } from '../PropertyForm';
import type { PropertyFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. */
function toUpdateDto(values: PropertyFormValues) {
  return {
    name: values.name,
    address: values.address || undefined,
    city: values.city || undefined,
    state: values.state || undefined,
    zipCode: values.zipCode || undefined,
  };
}

export default function EditPropertyPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState<Property | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.properties
      .get(id)
      .then((data) => {
        if (!cancelled) setProperty(data);
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
        toast({ title: 'Falha ao carregar propriedade', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: PropertyFormValues): Promise<void> {
    try {
      const updated = await api.properties.update(id, toUpdateDto(values));
      setProperty(updated);
      toast({ title: 'Alterações salvas', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    }
  }

  async function handleDelete(): Promise<void> {
    if (!property) return;
    if (!window.confirm(`Remover ${property.name}? Esta ação pode ser desfeita apenas pelo suporte.`)) return;

    setDeleting(true);
    try {
      await api.properties.remove(id);
      toast({ title: 'Propriedade removida', variant: 'success' });
      router.push('/properties');
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao remover', description: message, variant: 'error' });
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  if (notFound || !property) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Propriedade não encontrada</h1>
          <Link href="/properties" className="mt-4 inline-block text-sm text-primary-700 hover:underline">
            Voltar para a lista
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href="/properties" className="text-sm text-primary-700 hover:underline">
            &larr; Propriedades
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">{property.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Status: <strong>{property.status === 'active' ? 'Ativa' : 'Pendente'}</strong>
            {property.latitude && property.longitude ? ' · localização no mapa resolvida' : ''}
          </p>
        </div>
        <PropertyForm
          defaultValues={{
            name: property.name,
            address: property.address ?? '',
            city: property.city,
            state: property.state,
            zipCode: property.zipCode ?? '',
          }}
          onSubmit={handleSubmit}
          submitLabel="Salvar alterações"
          submittingLabel="Salvando"
          footer={
            <Button
              type="button"
              variant="danger"
              loading={deleting}
              onClick={handleDelete}
              className="w-full"
            >
              {deleting ? 'Removendo' : 'Remover propriedade'}
            </Button>
          }
        />
      </div>
    </main>
  );
}
