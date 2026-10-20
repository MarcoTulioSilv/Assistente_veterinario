'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { Animal, Product } from '@quironequine/shared-types';
import { Button, Input, Select } from '@/components/ui';
import { formatCentsToBRL, parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import {
  appointmentFormSchema,
  appointmentItemFormSchema,
  type AppointmentFormValues,
  type AppointmentItemFormValues,
} from './schema';
import { TYPE_LABELS } from './labels';

type FieldErrors = Partial<Record<keyof AppointmentFormValues, string>>;

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

const EMPTY_ITEM: AppointmentItemFormValues = {
  kind: 'procedure',
  productId: '',
  description: '',
  quantity: '1',
  unitPriceCents: '',
};

/** RF-ATD-006: itens + mão de obra + km×taxa — espelha calculateTotalCents (ms-clinical/services/billing.ts). */
function calculateTotalCents(
  items: AppointmentItemFormValues[],
  laborCents: number,
  displacementKm: number,
  displacementRateCents: number,
): number {
  const itemsCents = items.reduce((sum, item) => {
    const qty = parseOptionalNumber(item.quantity) ?? 0;
    const unitCents = parseBRLToCents(item.unitPriceCents) ?? 0;
    return sum + Math.round(qty * unitCents);
  }, 0);
  return itemsCents + laborCents + Math.round(displacementKm * displacementRateCents);
}

interface AppointmentFormProps {
  defaultValues?: Partial<AppointmentFormValues>;
  defaultItems?: AppointmentItemFormValues[];
  animals: Animal[];
  /** Vazio na criação (RF-ATD-004 cobre a localização temporária, não troca de animal). */
  animalId?: string;
  /** Edição: o vínculo com o animal não muda mais — select trancado no valor atual. */
  lockAnimal?: boolean;
  products: Product[];
  onSubmit: (values: AppointmentFormValues, items: AppointmentItemFormValues[], animalId: string) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  footer?: ReactNode;
}

export function AppointmentForm({
  defaultValues,
  defaultItems = [],
  animals,
  animalId: defaultAnimalId = '',
  lockAnimal = false,
  products,
  onSubmit,
  submitLabel,
  submittingLabel,
  footer,
}: AppointmentFormProps): React.ReactElement {
  const [animalId, setAnimalId] = useState(defaultAnimalId);
  const [type, setType] = useState(defaultValues?.type ?? '');
  const [performedAt, setPerformedAt] = useState(defaultValues?.performedAt ?? '');
  const [animalLocation, setAnimalLocation] = useState(defaultValues?.animalLocation ?? '');
  const [laborCents, setLaborCents] = useState(defaultValues?.laborCents ?? '');
  const [displacementKm, setDisplacementKm] = useState(defaultValues?.displacementKm ?? '');
  const [displacementRateCents, setDisplacementRateCents] = useState(
    defaultValues?.displacementRateCents ?? '',
  );
  const [items, setItems] = useState<AppointmentItemFormValues[]>(defaultItems);
  const [draftItem, setDraftItem] = useState<AppointmentItemFormValues>(EMPTY_ITEM);
  const [itemError, setItemError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [animalError, setAnimalError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function addItem(): void {
    const result = appointmentItemFormSchema.safeParse(draftItem);
    if (!result.success) {
      setItemError(result.error.issues[0]?.message ?? 'Item inválido');
      return;
    }
    setItems((prev) => [...prev, result.data]);
    setDraftItem(EMPTY_ITEM);
    setItemError(undefined);
  }

  function removeItem(index: number): void {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function selectProduct(productId: string): void {
    const product = products.find((p) => p.id === productId);
    setDraftItem((prev) => ({
      ...prev,
      productId,
      description: product?.name ?? prev.description,
      unitPriceCents: product ? String(product.salePriceCents / 100).replace('.', ',') : prev.unitPriceCents,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!animalId) {
      setAnimalError('Selecione o animal');
      return;
    }

    const result = appointmentFormSchema.safeParse({
      type,
      performedAt,
      animalLocation,
      laborCents,
      displacementKm,
      displacementRateCents,
    });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof AppointmentFormValues;
        errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setAnimalError(undefined);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data, items, animalId);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedAnimal = animals.find((a) => a.id === animalId);
  const totalPreviewCents = calculateTotalCents(
    items,
    parseBRLToCents(laborCents) ?? 0,
    parseOptionalNumber(displacementKm) ?? 0,
    parseBRLToCents(displacementRateCents) ?? 0,
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Select
        label="Animal"
        placeholder="Selecione o animal"
        options={animals.map((a) => ({ value: a.id, label: a.name }))}
        defaultValue={defaultAnimalId}
        onChange={(e) => setAnimalId(e.target.value)}
        error={animalError}
        disabled={lockAnimal}
        hint={lockAnimal ? 'Não é possível trocar o animal depois de criado.' : undefined}
      />
      {selectedAnimal?.propertyId === null && (
        <p className="text-sm text-amber-700">
          Este animal não tem propriedade/proprietário vinculado — cadastre isso antes de criar o atendimento.
        </p>
      )}

      <Select
        label="Tipo de atendimento"
        placeholder="Selecione"
        options={TYPE_OPTIONS}
        defaultValue={type}
        onChange={(e) => setType(e.target.value as AppointmentFormValues['type'])}
        error={fieldErrors.type}
      />

      <Input
        label="Data e hora"
        type="datetime-local"
        value={performedAt}
        onChange={(e) => setPerformedAt(e.target.value)}
        error={fieldErrors.performedAt}
      />

      <Input
        label="Local do animal (se não estiver na propriedade de registro)"
        placeholder="Ex.: Haras Vizinho, em trânsito"
        value={animalLocation}
        onChange={(e) => setAnimalLocation(e.target.value)}
        error={fieldErrors.animalLocation}
      />

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Itens do orçamento</legend>

        {items.length > 0 && (
          <ul className="mb-3 space-y-1">
            {items.map((item, index) => (
              <li key={index} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-900">
                  {item.quantity}× {item.description}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-medium text-slate-900">
                    {formatCentsToBRL(
                      Math.round((parseOptionalNumber(item.quantity) ?? 0) * (parseBRLToCents(item.unitPriceCents) ?? 0)),
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="text-red-600 hover:underline"
                    aria-label={`Remover ${item.description}`}
                  >
                    Remover
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={draftItem.kind === 'procedure' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDraftItem({ ...EMPTY_ITEM, kind: 'procedure' })}
          >
            Procedimento
          </Button>
          <Button
            type="button"
            variant={draftItem.kind === 'product' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDraftItem({ ...EMPTY_ITEM, kind: 'product' })}
          >
            Produto do estoque
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {draftItem.kind === 'product' ? (
            <div className="col-span-2">
              <Select
                key={draftItem.productId}
                label="Produto"
                placeholder="Selecione"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                defaultValue={draftItem.productId}
                onChange={(e) => selectProduct(e.target.value)}
              />
            </div>
          ) : (
            <div className="col-span-2">
              <Input
                label="Descrição"
                value={draftItem.description}
                onChange={(e) => setDraftItem((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
          )}
          <Input
            label="Quantidade"
            value={draftItem.quantity}
            onChange={(e) => setDraftItem((prev) => ({ ...prev, quantity: e.target.value }))}
          />
          <Input
            label="Valor unitário (R$)"
            placeholder="0,00"
            value={draftItem.unitPriceCents}
            onChange={(e) => setDraftItem((prev) => ({ ...prev, unitPriceCents: e.target.value }))}
          />
        </div>
        {itemError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {itemError}
          </p>
        )}
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addItem}>
          Adicionar item
        </Button>
      </fieldset>

      <div className="grid grid-cols-3 gap-3">
        <Input
          label="Mão de obra (R$)"
          placeholder="0,00"
          value={laborCents}
          onChange={(e) => setLaborCents(e.target.value)}
          error={fieldErrors.laborCents}
        />
        <Input
          label="Deslocamento (km)"
          placeholder="0"
          value={displacementKm}
          onChange={(e) => setDisplacementKm(e.target.value)}
          error={fieldErrors.displacementKm}
        />
        <Input
          label="Valor por km (R$)"
          placeholder="0,00"
          value={displacementRateCents}
          onChange={(e) => setDisplacementRateCents(e.target.value)}
          error={fieldErrors.displacementRateCents}
        />
      </div>

      <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold text-primary-800">
        <span>Total previsto</span>
        <span>{formatCentsToBRL(totalPreviewCents)}</span>
      </div>

      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
