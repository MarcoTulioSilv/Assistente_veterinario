'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { Owner, Property } from '@vetequine/shared-types';
import { Button, Input, Select } from '@/components/ui';
import { animalFormSchema, type AnimalFormValues } from './schema';

type FieldErrors = Partial<Record<keyof AnimalFormValues, string>>;

interface AnimalFormProps {
  defaultValues?: Partial<AnimalFormValues>;
  owners: Owner[];
  /** Só usado (e mostrado) quando showProperty=true, ou seja, na criação. */
  properties?: Property[];
  defaultPropertyId?: string;
  showProperty?: boolean;
  onSubmit: (values: AnimalFormValues, propertyId: string) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  footer?: ReactNode;
}

const SEX_OPTIONS = [
  { value: 'male', label: 'Macho' },
  { value: 'female', label: 'Fêmea' },
];

export function AnimalForm({
  defaultValues,
  owners,
  properties = [],
  defaultPropertyId = '',
  showProperty = true,
  onSubmit,
  submitLabel,
  submittingLabel,
  footer,
}: AnimalFormProps): React.ReactElement {
  const [name, setName] = useState(defaultValues?.name ?? '');
  const [species, setSpecies] = useState(defaultValues?.species ?? '');
  const [sex, setSex] = useState(defaultValues?.sex ?? '');
  const [breed, setBreed] = useState(defaultValues?.breed ?? '');
  const [coat, setCoat] = useState(defaultValues?.coat ?? '');
  const [birthDate, setBirthDate] = useState(defaultValues?.birthDate ?? '');
  const [castrated, setCastrated] = useState(defaultValues?.castrated ?? false);
  const [photoUrl, setPhotoUrl] = useState(defaultValues?.photoUrl ?? '');
  const [sketchUrl, setSketchUrl] = useState(defaultValues?.sketchUrl ?? '');
  const [ownerId, setOwnerId] = useState(defaultValues?.ownerId ?? '');
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = animalFormSchema.safeParse({
      name,
      species,
      sex,
      breed,
      coat,
      birthDate,
      castrated,
      photoUrl,
      sketchUrl,
      ownerId,
    });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof AnimalFormValues;
        errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data, propertyId);
    } finally {
      setSubmitting(false);
    }
  }

  const activationHint =
    showProperty && (!propertyId || !ownerId)
      ? 'Preencha propriedade e proprietário para o cadastro ficar ativo — sem isso, fica pendente.'
      : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Espécie"
          placeholder="equine"
          hint="Deixe em branco pra assumir equino"
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          error={fieldErrors.species}
        />
        <Select
          label="Sexo"
          placeholder="Selecione"
          options={SEX_OPTIONS}
          defaultValue={sex}
          onChange={(e) => setSex(e.target.value as '' | 'male' | 'female')}
          error={fieldErrors.sex}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Raça" value={breed} onChange={(e) => setBreed(e.target.value)} error={fieldErrors.breed} />
        <Input label="Pelagem" value={coat} onChange={(e) => setCoat(e.target.value)} error={fieldErrors.coat} />
      </div>
      <Input
        label="Data de nascimento"
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
        error={fieldErrors.birthDate}
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={castrated}
          onChange={(e) => setCastrated(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        Castrado
      </label>
      <Input
        label="URL da foto"
        type="url"
        hint="Link de uma imagem já hospedada — upload direto ainda não é suportado"
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
        error={fieldErrors.photoUrl}
      />
      <Input
        label="URL da resenha/desenho"
        type="url"
        hint="Identificação gráfica do equino (RF-CAD-023) — mesma ressalva de upload"
        value={sketchUrl}
        onChange={(e) => setSketchUrl(e.target.value)}
        error={fieldErrors.sketchUrl}
      />
      <Select
        label="Proprietário"
        placeholder="Sem proprietário definido"
        options={owners.map((o) => ({ value: o.id, label: o.fullName }))}
        defaultValue={ownerId}
        onChange={(e) => setOwnerId(e.target.value)}
        error={fieldErrors.ownerId}
      />
      {showProperty && (
        <Select
          label="Propriedade"
          placeholder="Sem propriedade definida"
          options={properties.map((p) => ({ value: p.id, label: p.name }))}
          defaultValue={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          hint={activationHint}
        />
      )}
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
