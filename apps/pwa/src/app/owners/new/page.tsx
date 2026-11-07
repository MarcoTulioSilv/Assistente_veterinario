'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { OwnerForm } from '../OwnerForm';
import type { OwnerFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. */
function toCreateDto(values: OwnerFormValues) {
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

export default function NewOwnerPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  async function handleSubmit(values: OwnerFormValues): Promise<void> {
    try {
      const owner = await api.owners.create(toCreateDto(values));
      toast({ title: 'Proprietário cadastrado', variant: 'success' });
      router.push(`/owners/${owner.id}`);
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
          <Link href="/owners" className="text-sm text-primary-700 hover:underline">
            &larr; Proprietários
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Novo proprietário</h1>
        </div>
        <OwnerForm onSubmit={handleSubmit} submitLabel="Cadastrar" submittingLabel="Cadastrando" />
      </div>
    </main>
  );
}
