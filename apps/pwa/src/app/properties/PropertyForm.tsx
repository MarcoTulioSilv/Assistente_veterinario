'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { BR_STATES } from '@/lib/br-states';
import { formatCep } from '@/lib/masks';
import { propertyFormSchema, type PropertyFormValues } from './schema';

type FieldErrors = Partial<Record<keyof PropertyFormValues, string>>;

interface PropertyFormProps {
  defaultValues?: Partial<PropertyFormValues>;
  onSubmit: (values: PropertyFormValues) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  /** Conteúdo extra renderizado entre os campos e o botão — ex: vínculo com proprietários (só na criação). */
  children?: ReactNode;
  footer?: ReactNode;
}

export function PropertyForm({
  defaultValues,
  onSubmit,
  submitLabel,
  submittingLabel,
  children,
  footer,
}: PropertyFormProps): React.ReactElement {
  const [name, setName] = useState(defaultValues?.name ?? '');
  const [address, setAddress] = useState(defaultValues?.address ?? '');
  const [city, setCity] = useState(defaultValues?.city ?? '');
  const [state, setState] = useState(defaultValues?.state ?? '');
  const [zipCode, setZipCode] = useState(defaultValues?.zipCode ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = propertyFormSchema.safeParse({ name, address, city, state, zipCode });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof PropertyFormValues;
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

  const activationHint =
    !address || !city || !state
      ? 'Preencha endereço, cidade e estado para o cadastro ficar ativo — sem isso, fica pendente.'
      : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Nome da propriedade"
        placeholder="Ex: Fazenda Santa Fé"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldErrors.name}
      />
      <Input
        label="Endereço"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={fieldErrors.address}
        hint={!fieldErrors.address ? activationHint : undefined}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} error={fieldErrors.city} />
        <Select
          label="Estado"
          placeholder="UF"
          options={BR_STATES}
          defaultValue={state}
          onChange={(e) => setState(e.target.value)}
          error={fieldErrors.state}
        />
      </div>
      <Input
        label="CEP"
        placeholder="00000-000"
        value={zipCode}
        onChange={(e) => setZipCode(formatCep(e.target.value))}
        error={fieldErrors.zipCode}
      />
      {children}
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
