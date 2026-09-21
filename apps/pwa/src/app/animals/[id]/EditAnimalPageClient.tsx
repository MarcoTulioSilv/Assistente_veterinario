'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Animal, Owner, Property } from '@quironequine/shared-types';
import { Button, Input, Select, Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { AnimalForm } from '../AnimalForm';
import type { AnimalFormValues } from '../schema';

/** Converte '' (placeholder de "não preenchido" no formulário) para undefined. propertyId nunca entra aqui — só via transfer(). */
function toUpdateDto(values: AnimalFormValues) {
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
  };
}

export function EditAnimalPageClient(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    Promise.all([
      api.animals.get(id),
      api.owners.list({ status: 'all', limit: 100 }),
      api.properties.list({ status: 'all', limit: 100 }),
    ])
      .then(([animalResult, ownersResult, propertiesResult]) => {
        if (cancelled) return;
        setAnimal(animalResult);
        setOwners(ownersResult.data);
        setProperties(propertiesResult.data);
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
        toast({ title: 'Falha ao carregar animal', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: AnimalFormValues): Promise<void> {
    try {
      const updated = await api.animals.update(id, toUpdateDto(values));
      setAnimal(updated);
      toast({ title: 'Alterações salvas', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    }
  }

  async function handleTransfer(): Promise<void> {
    if (!transferTo) return;
    setTransferring(true);
    try {
      const updated = await api.animals.transfer(id, transferTo, transferNotes || undefined);
      setAnimal(updated);
      setTransferTo('');
      setTransferNotes('');
      toast({ title: 'Animal transferido', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao transferir', description: message, variant: 'error' });
    } finally {
      setTransferring(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!animal) return;
    if (!window.confirm(`Remover ${animal.name}? Esta ação pode ser desfeita apenas pelo suporte.`)) return;

    setDeleting(true);
    try {
      await api.animals.remove(id);
      toast({ title: 'Animal removido', variant: 'success' });
      router.push('/animals');
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

  if (notFound || !animal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Animal não encontrado</h1>
          <Link href="/animals" className="mt-4 inline-block text-sm text-primary-700 hover:underline">
            Voltar para a lista
          </Link>
        </div>
      </main>
    );
  }

  const currentProperty = properties.find((p) => p.id === animal.propertyId);
  const transferOptions = properties
    .filter((p) => p.id !== animal.propertyId)
    .map((p) => ({ value: p.id, label: p.name }));

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 p-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <Link href="/animals" className="text-sm text-primary-700 hover:underline">
            &larr; Animais
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">{animal.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Status: <strong>{animal.status === 'active' ? 'Ativo' : 'Pendente'}</strong>
            {' · '}
            {currentProperty ? currentProperty.name : 'sem propriedade'}
          </p>
        </div>

        <AnimalForm
          defaultValues={{
            name: animal.name,
            species: animal.species,
            sex: animal.sex ?? '',
            breed: animal.breed ?? '',
            coat: animal.coat ?? '',
            birthDate: animal.birthDate?.slice(0, 10) ?? '',
            castrated: animal.castrated,
            photoUrl: animal.photoUrl ?? '',
            sketchUrl: animal.sketchUrl ?? '',
            ownerId: animal.ownerId ?? '',
          }}
          owners={owners}
          showProperty={false}
          onSubmit={handleSubmit}
          submitLabel="Salvar alterações"
          submittingLabel="Salvando"
        />

        {transferOptions.length > 0 && (
          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6">
            <span className="text-sm font-medium text-slate-700">
              Transferir para outra propriedade
            </span>
            <p className="text-sm text-slate-500">
              Diferente de editar os dados acima, isso fica registrado no histórico do animal (RN-010).
            </p>
            <Select
              label="Nova propriedade"
              placeholder="Selecione"
              options={transferOptions}
              defaultValue=""
              onChange={(e) => setTransferTo(e.target.value)}
            />
            <Input
              label="Observações (opcional)"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              loading={transferring}
              disabled={!transferTo}
              onClick={handleTransfer}
              className="w-full"
            >
              {transferring ? 'Transferindo' : 'Transferir'}
            </Button>
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-6">
          <Button type="button" variant="danger" loading={deleting} onClick={handleDelete} className="w-full">
            {deleting ? 'Removendo' : 'Remover animal'}
          </Button>
        </div>
      </div>
    </main>
  );
}
