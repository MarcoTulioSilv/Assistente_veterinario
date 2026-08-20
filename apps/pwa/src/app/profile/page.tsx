'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TenantProfile } from '@vetequine/shared-types';
import { Button, Input, Spinner, useToast } from '@/components/ui';
import { api, ApiClientError, hasSession } from '@/lib/api';
import { profileSchema } from './schema';

type FieldErrors = Partial<Record<'fullName' | 'phone' | 'email' | 'logoUrl', string>>;

export default function ProfilePage(): React.ReactElement | null {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    api.tenants
      .getMe()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setFullName(data.veterinarian.fullName);
        setPhone(data.veterinarian.phone);
        setEmail(data.veterinarian.email);
        setLogoUrl(data.veterinarian.logoUrl ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        const message =
          err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
        toast({ title: 'Falha ao carregar perfil', description: message, variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = profileSchema.safeParse({ fullName, phone, email, logoUrl });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field === 'fullName' || field === 'phone' || field === 'email' || field === 'logoUrl') {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const updated = await api.tenants.updateMe({
        fullName: result.data.fullName,
        phone: result.data.phone,
        email: result.data.email,
        logoUrl: result.data.logoUrl || undefined,
      });
      setProfile(updated);
      toast({ title: 'Perfil atualizado', variant: 'success' });
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha ao salvar', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </main>
    );
  }

  if (!profile) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-primary-800">Meu perfil</h1>
          <p className="mt-1 text-sm text-slate-500">Dados do veterinário responsável</p>
        </div>

        <dl className="mb-6 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-slate-50 p-3 text-sm">
          <dt className="text-slate-500">CRMV</dt>
          <dd className="text-slate-900">
            {profile.veterinarian.crmv}/{profile.veterinarian.crmvState}
          </dd>
          <dt className="text-slate-500">CPF/CNPJ</dt>
          <dd className="text-slate-900">{profile.veterinarian.cpfCnpj}</dd>
        </dl>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="Nome completo"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={fieldErrors.fullName}
          />
          <Input
            label="Telefone"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={fieldErrors.phone}
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
            label="URL do logo"
            type="url"
            hint="Link de uma imagem já hospedada — upload direto ainda não é suportado"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            error={fieldErrors.logoUrl}
          />
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            {submitting ? 'Salvando' : 'Salvar alterações'}
          </Button>
        </form>
      </div>
    </main>
  );
}
