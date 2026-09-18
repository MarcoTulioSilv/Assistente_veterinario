'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CreateProductDto, ProductCategory, ProductUnit } from '@quironequine/shared-types';
import { Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import { ProductForm } from '../ProductForm';
import type { ProductFormValues } from '../schema';

function toCreateDto(values: ProductFormValues): CreateProductDto {
  return {
    name: values.name,
    manufacturer: values.manufacturer || undefined,
    batch: values.batch || undefined,
    unit: values.unit as ProductUnit,
    category: values.category as ProductCategory,
    quantityInStock: parseOptionalNumber(values.quantityInStock ?? ''),
    dosesPerUnit: parseOptionalNumber(values.dosesPerUnit ?? ''),
    costPriceCents: parseBRLToCents(values.costPrice) ?? 0,
    markupPercent: parseOptionalNumber(values.markupPercent ?? ''),
    expiryDate: values.expiryDate || undefined,
    alertDaysBefore: parseOptionalNumber(values.alertDaysBefore ?? ''),
    minStockQty: parseOptionalNumber(values.minStockQty ?? ''),
  };
}

export default function NewProductPage(): React.ReactElement | null {
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

  async function handleSubmit(values: ProductFormValues): Promise<void> {
    try {
      const product = await api.products.create(toCreateDto(values));
      toast({ title: 'Produto cadastrado', variant: 'success' });
      router.push(`/inventory/${product.id}`);
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
          <Link href="/inventory" className="text-sm text-primary-700 hover:underline">
            &larr; Estoque
          </Link>
          <h1 className="mt-2 text-xl font-bold text-primary-800">Novo produto</h1>
        </div>
        <ProductForm
          showStock
          onSubmit={handleSubmit}
          submitLabel="Cadastrar"
          submittingLabel="Cadastrando"
        />
      </div>
    </main>
  );
}
