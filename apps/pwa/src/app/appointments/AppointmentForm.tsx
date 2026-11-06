'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { Animal, Product, Property } from '@quironequine/shared-types';
import { Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formatCentsToBRL, parseBRLToCents, parseOptionalNumber } from '@/lib/money';
import {
  appointmentFormSchema,
  appointmentItemFormSchema,
  EMPTY_MEDICAL_RECORD,
  type AnimalClinicalFormValues,
  type AppointmentFormValues,
  type AppointmentItemFormValues,
} from './schema';
import { TYPE_LABELS } from './labels';
import { AnimalClinicalEditor } from './AnimalClinicalEditor';

// Leaflet mexe em `window` direto -- só pode existir no client (mesmo
// padrão de properties/new/page.tsx).
const LocationPicker = dynamic(
  () => import('../properties/LocationPicker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-md bg-slate-100" /> },
);

type Coords = { latitude: number; longitude: number };

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

const EMPTY_ITEM: AppointmentItemFormValues = { productId: '', description: '', quantity: '1', unitPriceCents: '' };

/**
 * Nome padrão do orçamento (reunião 2026-11-03): "Data - Especialidade -
 * Propriedade". O backend só sabe fazer "Data - Especialidade" (ADR-001,
 * sem join cross-service pro nome da propriedade) — a tela acrescenta a
 * propriedade antes de enviar. Mesmo separador " - " do backend.
 */
function defaultTitle(performedAt: string, type: AppointmentFormValues['type'] | '', propertyName: string): string {
  if (!performedAt || !type) return '';
  const date = new Date(performedAt);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const base = `${dd}/${mm}/${date.getFullYear()} - ${TYPE_LABELS[type]}`;
  return propertyName ? `${base} - ${propertyName}` : base;
}

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

type FieldErrors = Partial<Record<keyof AppointmentFormValues, string>>;

export interface AppointmentFormProps {
  properties: Property[];
  /** Todos os animais ativos — filtrados na tela pela propriedade escolhida. */
  animals: Animal[];
  products: Product[];
  defaultValues?: Partial<AppointmentFormValues>;
  defaultPropertyId?: string;
  defaultAnimalIds?: string[];
  defaultItems?: AppointmentItemFormValues[];
  defaultClinical?: Record<string, AnimalClinicalFormValues>;
  defaultLocation?: Coords | null;
  onSubmit: (
    values: AppointmentFormValues,
    items: AppointmentItemFormValues[],
    propertyId: string,
    animalIds: string[],
    clinical: Record<string, AnimalClinicalFormValues>,
    location: Coords | null,
  ) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  footer?: ReactNode;
}

export function AppointmentForm({
  properties,
  animals,
  products,
  defaultValues,
  defaultPropertyId = '',
  defaultAnimalIds = [],
  defaultItems = [],
  defaultClinical = {},
  defaultLocation = null,
  onSubmit,
  submitLabel,
  submittingLabel,
  footer,
}: AppointmentFormProps): React.ReactElement {
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [animalIds, setAnimalIds] = useState<string[]>(defaultAnimalIds);
  const [title, setTitle] = useState(defaultValues?.title ?? '');
  // Se já veio um título (edição, ou duplicar no futuro), não sobrescreve
  // sozinho; só o usuário digitar conta como "touched" daqui pra frente.
  const [titleTouched, setTitleTouched] = useState(!!defaultValues?.title);
  const [type, setType] = useState<AppointmentFormValues['type'] | ''>(defaultValues?.type ?? '');
  const [performedAt, setPerformedAt] = useState(defaultValues?.performedAt ?? '');
  const [animalLocation, setAnimalLocation] = useState(defaultValues?.animalLocation ?? '');
  const [procedureDescription, setProcedureDescription] = useState(defaultValues?.procedureDescription ?? '');
  const [laborCents, setLaborCents] = useState(defaultValues?.laborCents ?? '');
  const [displacementKm, setDisplacementKm] = useState(defaultValues?.displacementKm ?? '');
  const [displacementRateCents, setDisplacementRateCents] = useState(
    defaultValues?.displacementRateCents ?? '',
  );
  const [items, setItems] = useState<AppointmentItemFormValues[]>(defaultItems);
  const [draftItem, setDraftItem] = useState<AppointmentItemFormValues>(EMPTY_ITEM);
  const [itemError, setItemError] = useState<string | undefined>();
  const [clinical, setClinical] = useState<Record<string, AnimalClinicalFormValues>>(defaultClinical);
  const [destination, setDestination] = useState<Coords | null>(defaultLocation);
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [calculatingKm, setCalculatingKm] = useState(false);
  const [routeHint, setRouteHint] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [animalError, setAnimalError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const animalsInProperty = animals.filter((a) => a.propertyId === propertyId);
  const selectedDraftProduct = products.find((p) => p.id === draftItem.productId);
  const draftQuantityUnit = selectedDraftProduct
    ? selectedDraftProduct.pricePerMlCents !== null
      ? 'ml'
      : selectedDraftProduct.unit
    : 'unidade';

  function clinicalFor(animalId: string): AnimalClinicalFormValues {
    return clinical[animalId] ?? { medicalRecord: { ...EMPTY_MEDICAL_RECORD }, prescriptions: [] };
  }

  /** Recalcula o nome padrão enquanto o usuário não tiver digitado o próprio. */
  function applyAutoTitle(nextPerformedAt: string, nextType: AppointmentFormValues['type'] | '', nextPropertyId: string): void {
    if (titleTouched) return;
    const propertyName = properties.find((p) => p.id === nextPropertyId)?.name ?? '';
    setTitle(defaultTitle(nextPerformedAt, nextType, propertyName));
  }

  function handleTitleChange(value: string): void {
    setTitle(value);
    setTitleTouched(true);
  }

  function selectProperty(id: string): void {
    setPropertyId(id);
    // Troca de propriedade invalida os animais escolhidos de outra.
    setAnimalIds((prev) => prev.filter((animalId) => animals.find((a) => a.id === animalId)?.propertyId === id));
    const property = properties.find((p) => p.id === id);
    if (property?.latitude !== null && property?.latitude !== undefined && property.longitude !== null && property.longitude !== undefined) {
      setDestination({ latitude: property.latitude, longitude: property.longitude });
    }
    applyAutoTitle(performedAt, type, id);
  }

  function toggleAnimal(animalId: string): void {
    setAnimalIds((prev) => (prev.includes(animalId) ? prev.filter((id) => id !== animalId) : [...prev, animalId]));
  }

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
    // pricePerMlCents != null => AppointmentItem.quantity é em ml, e esse é
    // o preço sugerido (ADR-002 rev. 1.5 / reunião 2026-11-03); senão, é por
    // unidade de compra, igual antes.
    const priceCents = product ? product.pricePerMlCents ?? product.salePriceCents : null;
    setDraftItem((prev) => ({
      ...prev,
      productId,
      description: product?.name ?? prev.description,
      unitPriceCents: priceCents !== null ? String(priceCents / 100).replace('.', ',') : prev.unitPriceCents,
    }));
  }

  async function calculateKm(): Promise<void> {
    if (!origin || !destination) return;
    setCalculatingKm(true);
    setRouteHint(undefined);
    try {
      const result = await api.geo.route(origin, destination);
      if (!result) {
        setRouteHint('Rota indisponível agora — informe o km manualmente.');
        return;
      }
      setDisplacementKm(String(result.distanceKm).replace('.', ','));
      setRouteHint(`${result.distanceKm} km, ~${result.durationMinutes} min de carro — pode ajustar.`);
    } catch {
      setRouteHint('Não foi possível calcular a rota agora — informe o km manualmente.');
    } finally {
      setCalculatingKm(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!propertyId) {
      setAnimalError('Selecione a propriedade');
      return;
    }
    if (animalIds.length === 0) {
      setAnimalError('Selecione ao menos um animal');
      return;
    }

    const result = appointmentFormSchema.safeParse({
      title,
      type,
      performedAt,
      animalLocation,
      procedureDescription,
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
      const relevantClinical = Object.fromEntries(
        Object.entries(clinical).filter(([animalId]) => animalIds.includes(animalId)),
      );
      await onSubmit(result.data, items, propertyId, animalIds, relevantClinical, destination);
    } finally {
      setSubmitting(false);
    }
  }

  const totalPreviewCents = calculateTotalCents(
    items,
    parseBRLToCents(laborCents) ?? 0,
    parseOptionalNumber(displacementKm) ?? 0,
    parseBRLToCents(displacementRateCents) ?? 0,
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Select
        label="Propriedade"
        placeholder="Selecione a propriedade"
        options={properties.map((p) => ({ value: p.id, label: p.name }))}
        defaultValue={defaultPropertyId}
        onChange={(e) => selectProperty(e.target.value)}
      />

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Animais do orçamento</legend>
        {!propertyId ? (
          <p className="text-sm text-slate-400">Selecione a propriedade primeiro.</p>
        ) : animalsInProperty.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum animal ativo nesta propriedade.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {animalsInProperty.map((animal) => (
              <label key={animal.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={animalIds.includes(animal.id)}
                  onChange={() => toggleAnimal(animal.id)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                {animal.name}
              </label>
            ))}
          </div>
        )}
        {animalError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {animalError}
          </p>
        )}
      </fieldset>

      {animalIds.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Ficha clínica e receita, por animal</span>
          {animalIds.map((animalId) => {
            const animal = animals.find((a) => a.id === animalId);
            if (!animal) return null;
            return (
              <AnimalClinicalEditor
                key={animalId}
                animalName={animal.name}
                value={clinicalFor(animalId)}
                onChange={(value) => setClinical((prev) => ({ ...prev, [animalId]: value }))}
              />
            );
          })}
        </div>
      )}

      <Input
        label="Nome do orçamento"
        hint="Pré-preenchido com data, especialidade e propriedade — pode trocar."
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        error={fieldErrors.title}
      />

      <Select
        label="Tipo de atendimento"
        placeholder="Selecione"
        options={TYPE_OPTIONS}
        defaultValue={type}
        onChange={(e) => {
          const next = e.target.value as AppointmentFormValues['type'];
          setType(next);
          applyAutoTitle(performedAt, next, propertyId);
        }}
        error={fieldErrors.type}
      />

      <Input
        label="Data e hora"
        type="datetime-local"
        value={performedAt}
        onChange={(e) => {
          setPerformedAt(e.target.value);
          applyAutoTitle(e.target.value, type, propertyId);
        }}
        error={fieldErrors.performedAt}
      />

      <Input
        label="Local do animal (se não estiver na propriedade de registro)"
        placeholder="Ex.: Haras Vizinho, em trânsito"
        value={animalLocation}
        onChange={(e) => setAnimalLocation(e.target.value)}
        error={fieldErrors.animalLocation}
      />

      <Input
        label="Procedimento realizado"
        placeholder="Ex.: Consulta de rotina"
        value={procedureDescription}
        onChange={(e) => setProcedureDescription(e.target.value)}
        error={fieldErrors.procedureDescription}
      />

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Itens do estoque</legend>

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

        <div className="grid grid-cols-2 gap-2">
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
          <Input
            label={`Quantidade (${draftQuantityUnit})`}
            value={draftItem.quantity}
            onChange={(e) => setDraftItem((prev) => ({ ...prev, quantity: e.target.value }))}
          />
          <Input
            label={`Valor por ${draftQuantityUnit} (R$)`}
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

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Local do atendimento (mapa)</span>
        <LocationPicker value={destination} onChange={setDestination} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">De onde você está saindo (km automático)</span>
        <LocationPicker value={origin} onChange={setOrigin} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={calculatingKm}
          disabled={!origin || !destination}
          onClick={calculateKm}
        >
          {calculatingKm ? 'Calculando' : 'Calcular km automaticamente'}
        </Button>
        {routeHint && <span className="text-sm text-slate-500">{routeHint}</span>}
      </div>

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
