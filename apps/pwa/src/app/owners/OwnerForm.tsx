'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { BR_STATES } from '@/lib/br-states';
import { formatCpf } from '@/lib/masks';
import { ownerFormSchema, type OwnerFormValues } from './schema';

type FieldErrors = Partial<Record<keyof OwnerFormValues, string>>;

interface OwnerFormProps {
  defaultValues?: Partial<OwnerFormValues>;
  onSubmit: (values: OwnerFormValues) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  footer?: ReactNode;
}

export function OwnerForm({
  defaultValues,
  onSubmit,
  submitLabel,
  submittingLabel,
  footer,
}: OwnerFormProps): React.ReactElement {
  const [fullName, setFullName] = useState(defaultValues?.fullName ?? '');
  const [cpf, setCpf] = useState(defaultValues?.cpf ?? '');
  const [email, setEmail] = useState(defaultValues?.email ?? '');
  const [phone, setPhone] = useState(defaultValues?.phone ?? '');
  const [phone2, setPhone2] = useState(defaultValues?.phone2 ?? '');
  const [address, setAddress] = useState(defaultValues?.address ?? '');
  const [city, setCity] = useState(defaultValues?.city ?? '');
  const [state, setState] = useState(defaultValues?.state ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = ownerFormSchema.safeParse({
      fullName,
      cpf,
      email,
      phone,
      phone2,
      address,
      city,
      state,
    });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof OwnerFormValues;
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
    !cpf || !phone ? 'Preencha CPF e telefone para o cadastro ficar ativo — sem isso, fica pendente.' : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Nome completo"
        autoComplete="name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        error={fieldErrors.fullName}
      />
      <Input
        label="CPF"
        placeholder="000.000.000-00"
        value={cpf}
        onChange={(e) => setCpf(formatCpf(e.target.value))}
        error={fieldErrors.cpf}
        hint={!fieldErrors.cpf ? activationHint : undefined}
      />
      <Input
        label="Telefone"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={fieldErrors.phone}
      />
      <Input
        label="Telefone alternativo"
        autoComplete="tel"
        value={phone2}
        onChange={(e) => setPhone2(e.target.value)}
        error={fieldErrors.phone2}
      />
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
      />
      <Input
        label="Endereço"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={fieldErrors.address}
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
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {submitting ? submittingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
