'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, useToast } from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { login } from '@/lib/auth';
import { loginSchema } from './schema';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const tokens = await login(result.data.email, result.data.password);
      toast({ title: `Bem-vindo(a), ${tokens.user.fullName}`, variant: 'success' });
      router.replace('/profile');
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.body.message : 'Não foi possível conectar ao servidor';
      toast({ title: 'Falha no login', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-primary-800">VetEquine</h1>
          <p className="mt-1 text-sm text-slate-500">Entre com sua conta para continuar</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
          />
          <Input
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
          <Link
            href="/forgot-password"
            className="-mt-2 self-end text-sm text-primary-700 hover:underline"
          >
            Esqueci minha senha
          </Link>
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            {submitting ? 'Entrando' : 'Entrar'}
          </Button>
        </form>
      </div>
    </main>
  );
}
