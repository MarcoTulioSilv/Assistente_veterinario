'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { productFormSchema, type ProductFormValues } from './schema';

type FieldErrors = Partial<Record<keyof ProductFormValues, string>>;

interface ProductFormProps {
  defaultValues?: Partial<ProductFormValues>;
  /** Estoque inicial só é editável na criação — depois, só via lançamento de movimentação (RF-EST-007). */
  showStock?: boolean;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  footer?: ReactNode;
}

const UNIT_OPTIONS = [
  { value: 'ampola', label: 'Ampola' },
  { value: 'bolsa', label: 'Bolsa' },
  { value: 'caixa', label: 'Caixa' },
  { value: 'frasco', label: 'Frasco' },
  { value: 'galao', label: 'Galão' },
  { value: 'grama', label: 'Grama (g)' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'litros', label: 'Litros (L)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'pacote', label: 'Pacote' },
  { value: 'peca', label: 'Peça' },
  { value: 'unidade', label: 'Unidade' },
];

const CATEGORY_OPTIONS = [
  { value: 'medication', label: 'Medicamento' },
  { value: 'vaccine', label: 'Vacina' },
  { value: 'supply', label: 'Insumo' },
];

export function ProductForm({
  defaultValues,
  showStock = false,
  onSubmit,
  submitLabel,
  submittingLabel,
  footer,
}: ProductFormProps): React.ReactElement {
  const [name, setName] = useState(defaultValues?.name ?? '');
  const [manufacturer, setManufacturer] = useState(defaultValues?.manufacturer ?? '');
  const [batch, setBatch] = useState(defaultValues?.batch ?? '');
  const [unit, setUnit] = useState(defaultValues?.unit ?? '');
  const [category, setCategory] = useState(defaultValues?.category ?? '');
  const [quantityInStock, setQuantityInStock] = useState(defaultValues?.quantityInStock ?? '');
  const [dosesPerUnit, setDosesPerUnit] = useState(defaultValues?.dosesPerUnit ?? '');
  const [costPrice, setCostPrice] = useState(defaultValues?.costPrice ?? '');
  const [markupPercent, setMarkupPercent] = useState(defaultValues?.markupPercent ?? '');
  const [expiryDate, setExpiryDate] = useState(defaultValues?.expiryDate ?? '');
  const [alertDaysBefore, setAlertDaysBefore] = useState(defaultValues?.alertDaysBefore ?? '');
  const [minStockQty, setMinStockQty] = useState(defaultValues?.minStockQty ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = productFormSchema.safeParse({
      name,
      manufacturer,
      batch,
      unit,
      category,
      quantityInStock,
      dosesPerUnit,
      costPrice,
      markupPercent,
      expiryDate,
      alertDaysBefore,
      minStockQty,
    });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof ProductFormValues;
        errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Categoria"
          placeholder="Selecione"
          options={CATEGORY_OPTIONS}
          defaultValue={category}
          onChange={(e) => setCategory(e.target.value)}
          error={fieldErrors.category}
        />
        <Select
          label="Unidade"
          placeholder="Selecione"
          options={UNIT_OPTIONS}
          defaultValue={unit}
          onChange={(e) => setUnit(e.target.value)}
          error={fieldErrors.unit}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Fabricante"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          error={fieldErrors.manufacturer}
        />
        <Input label="Lote" value={batch} onChange={(e) => setBatch(e.target.value)} error={fieldErrors.batch} />
      </div>
      {showStock && (
        <Input
          label="Estoque inicial"
          placeholder="0"
          hint="Depois de criado, só muda via lançamento de movimentação"
          value={quantityInStock}
          onChange={(e) => setQuantityInStock(e.target.value)}
          error={fieldErrors.quantityInStock}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Valor de custo (R$)"
          placeholder="0,00"
          value={costPrice}
          onChange={(e) => setCostPrice(e.target.value)}
          error={fieldErrors.costPrice}
        />
        <Input
          label="Acréscimo (%)"
          placeholder="0"
          hint="RN-004: define o valor de venda"
          value={markupPercent}
          onChange={(e) => setMarkupPercent(e.target.value)}
          error={fieldErrors.markupPercent}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Estoque mínimo"
          placeholder="0"
          hint="Alerta de baixo estoque"
          value={minStockQty}
          onChange={(e) => setMinStockQty(e.target.value)}
          error={fieldErrors.minStockQty}
        />
        <Input
          label="Doses por unidade"
          placeholder="Opcional"
          value={dosesPerUnit}
          onChange={(e) => setDosesPerUnit(e.target.value)}
          error={fieldErrors.dosesPerUnit}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Validade"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          error={fieldErrors.expiryDate}
        />
        <Input
          label="Alertar dias antes"
          placeholder="30"
          value={alertDaysBefore}
          onChange={(e) => setAlertDaysBefore(e.target.value)}
          error={fieldErrors.alertDaysBefore}
        />
      </div>
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
