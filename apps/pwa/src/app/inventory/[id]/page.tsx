'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { CreateMovementDto, Product, StockMovement, UpdateProductDto } from '@quironequine/shared-types';
import { Button, Input, Select, Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCentsToBRL, parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { ProductForm } from '../ProductForm';
import { movementFormSchema, type MovementFormValues, type ProductFormValues } from '../schema';

function toUpdateDto(values: ProductFormValues): UpdateProductDto {
  return {
    name: values.name,
    manufacturer: values.manufacturer || undefined,
    batch: values.batch || undefined,
    unit: values.unit as UpdateProductDto['unit'],
    category: values.category as UpdateProductDto['category'],
    dosesPerUnit: parseOptionalNumber(values.dosesPerUnit ?? ''),
    costPriceCents: parseBRLToCents(values.costPrice),
    markupPercent: parseOptionalNumber(values.markupPercent ?? ''),
    expiryDate: values.expiryDate || undefined,
    alertDaysBefore: parseOptionalNumber(values.alertDaysBefore ?? ''),
    minStockQty: parseOptionalNumber(values.minStockQty ?? ''),
  };
}

const MOVEMENT_REASON_LABEL: Record<string, string> = {
  purchase: 'Compra',
  appointment: 'Atendimento',
  exam: 'Exame',
  vaccination: 'Vacinação',
  manual: 'Ajuste manual',
  expired: 'Vencido',
};

interface MovementLedgerProps {
  productId: string;
  unit: string;
  /** Avisa o pai pra recarregar o produto -- o estoque/badges no topo da página ficariam desatualizados sem isto. */
  onMovementRecorded: () => void;
}

type MovementFieldErrors = Partial<Record<keyof MovementFormValues, string>>;

function MovementLedger({ productId, unit, onMovementRecorded }: MovementLedgerProps): React.ReactElement {
  const { toast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [type, setType] = useState<'in' | 'out' | ''>('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<'purchase' | 'manual' | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<MovementFieldErrors>({});

  function loadMovements(): void {
    setLoadingMovements(true);
    api.products
      .listMovements(productId, { limit: 20 })
      .then((result) => setMovements(result.data))
      .catch(() => toast({ title: 'Falha ao carregar movimentações', variant: 'error' }))
      .finally(() => setLoadingMovements(false));
  }

  useEffect(() => {
    loadMovements();
  }, [productId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = movementFormSchema.safeParse({ type, quantity, reason, notes });
    if (!result.success) {
      const errors: MovementFieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof MovementFormValues;
        errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    const data: CreateMovementDto = {
      type: result.data.type,
      reason: result.data.reason,
      quantity: Number(result.data.quantity.replace(',', '.')),
      notes: result.data.notes || undefined,
    };

    setSubmitting(true);
    try {
      await api.products.recordMovement(productId, data);
      toast({ title: 'Movimentação registrada', variant: 'success' });
      setQuantity('');
      setNotes('');
      loadMovements();
      onMovementRecorded();
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao registrar movimentação', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-700">Movimentações de estoque</h2>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Tipo"
            placeholder="Selecione"
            options={[
              { value: 'in', label: 'Entrada' },
              { value: 'out', label: 'Saída' },
            ]}
            defaultValue={type}
            onChange={(e) => setType(e.target.value as 'in' | 'out')}
            error={fieldErrors.type}
          />
          <Input
            label={`Quantidade (${unit})`}
            placeholder="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={fieldErrors.quantity}
          />
        </div>
        <Select
          label="Motivo"
          placeholder="Selecione"
          options={[
            { value: 'purchase', label: 'Compra' },
            { value: 'manual', label: 'Ajuste manual' },
          ]}
          defaultValue={reason}
          onChange={(e) => setReason(e.target.value as 'purchase' | 'manual')}
          error={fieldErrors.reason}
        />
        <Input
          label="Observações"
          placeholder="Opcional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={fieldErrors.notes}
        />
        <Button type="submit" variant="secondary" loading={submitting} size="sm" className="self-start">
          {submitting ? 'Registrando' : 'Registrar movimentação'}
        </Button>
      </form>

      {loadingMovements ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : movements.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma movimentação registrada ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200">
          {movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-slate-900">
                  {MOVEMENT_REASON_LABEL[m.reason] ?? m.reason}
                  {m.notes ? ` — ${m.notes}` : ''}
                </p>
                <p className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString('pt-BR')}</p>
              </div>
              <span className={cn('shrink-0 font-medium', m.type === 'in' ? 'text-emerald-700' : 'text-red-700')}>
                {m.type === 'in' ? '+' : '-'}
                {m.quantity} {unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EditProductPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.products
      .get(id)
      .then((data) => {
        if (!cancelled) setProduct(data);
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
        toast({ title: 'Falha ao carregar produto', variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: ProductFormValues): Promise<void> {
    try {
      const updated = await api.products.update(id, toUpdateDto(values));
      setProduct(updated);
      toast({ title: 'Alterações salvas', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    }
  }

  /** Recarrega o produto pra refletir estoque/badges depois de um lançamento de movimentação. */
  function handleMovementRecorded(): void {
    api.products
      .get(id)
      .then(setProduct)
      .catch(() => undefined);
  }

  async function handleDelete(): Promise<void> {
    if (!product) return;
    if (!window.confirm(`Remover ${product.name}? Esta ação pode ser desfeita apenas pelo suporte.`)) return;

    setDeleting(true);
    try {
      await api.products.remove(id);
      toast({ title: 'Produto removido', variant: 'success' });
      router.push('/inventory');
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

  if (notFound || !product) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-primary-800">Produto não encontrado</h1>
          <Link href="/inventory" className="mt-4 inline-block text-sm text-primary-700 hover:underline">
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
          <Link href="/inventory" className="text-sm text-primary-700 hover:underline">
            &larr; Estoque
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">{product.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {product.quantityInStock} {product.unit} em estoque · Venda: {formatCentsToBRL(product.salePriceCents)}
          </p>
          <div className="mt-2 flex gap-2">
            {product.isLowStock && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                Baixo estoque
              </span>
            )}
            {product.isNearExpiry && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                Vencendo
              </span>
            )}
          </div>
        </div>
        <ProductForm
          defaultValues={{
            name: product.name,
            manufacturer: product.manufacturer ?? '',
            batch: product.batch ?? '',
            unit: product.unit,
            category: product.category,
            dosesPerUnit: product.dosesPerUnit !== null ? String(product.dosesPerUnit) : '',
            costPrice: (product.costPriceCents / 100).toFixed(2).replace('.', ','),
            markupPercent: String(product.markupPercent),
            expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : '',
            alertDaysBefore: String(product.alertDaysBefore),
            minStockQty: String(product.minStockQty),
          }}
          onSubmit={handleSubmit}
          submitLabel="Salvar alterações"
          submittingLabel="Salvando"
          footer={
            <Button type="button" variant="danger" loading={deleting} onClick={handleDelete} className="w-full">
              {deleting ? 'Removendo' : 'Remover produto'}
            </Button>
          }
        />
        <MovementLedger productId={id} unit={product.unit} onMovementRecorded={handleMovementRecorded} />
      </div>
    </main>
  );
}
