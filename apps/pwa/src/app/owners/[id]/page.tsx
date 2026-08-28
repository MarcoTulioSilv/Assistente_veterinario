'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Owner } from '@vetequine/shared-types';
import { Button, Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { OwnerForm } from '../OwnerForm';
import type { OwnerFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. */
function toUpdateDto(values: OwnerFormValues) {
  return {
    fullName: values.fullName,
    cpf: values.cpf || undefined,
    email: values.email || undefined,
    phone: values.phone || undefined,
    phone2: values.phone2 || undefined,
    address: values.address || undefined,
    city: values.city || undefined,
    state: values.state || undefined,
  };
}

export default function EditOwnerPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.owners
      .get(id)
      .then((data) => {
        if (!cancelled) setOwner(data);
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
        toast({ title: 'Falha ao carregar proprietário', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: OwnerFormValues): Promise<void> {
    try {
      const updated = await api.owners.update(id, toUpdateDto(values));
      setOwner(updated);
      toast({ title: 'Alterações salvas', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    }
  }

  async function handleDelete(): Promise<void> {
    if (!owner) return;
    if (!window.confirm(`Remover ${owner.fullName}? Esta ação pode ser desfeita apenas pelo suporte.`)) return;

    setDeleting(true);
    try {
      await api.owners.remove(id);
      toast({ title: 'Proprietário removido', variant: 'success' });
      router.push('/owners');
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

  if (notFound || !owner) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Proprietário não encontrado</h1>
          <Link href="/owners" className="mt-4 inline-block text-sm text-primary-700 hover:underline">
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
          <Link href="/owners" className="text-sm text-primary-700 hover:underline">
            &larr; Proprietários
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">{owner.fullName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Status: <strong>{owner.status === 'active' ? 'Ativo' : 'Pendente'}</strong>
          </p>
        </div>
        <OwnerForm
          defaultValues={{
            fullName: owner.fullName,
            cpf: owner.cpf ?? '',
            email: owner.email ?? '',
            phone: owner.phone,
            phone2: owner.phone2 ?? '',
            address: owner.address ?? '',
            city: owner.city,
            state: owner.state,
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
              {deleting ? 'Removendo' : 'Remover proprietário'}
            </Button>
          }
        />
      </div>
    </main>
  );
}
