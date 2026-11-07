'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, Input } from '@/components/ui';
import { mockRequestPasswordReset } from '@/lib/mock-auth';
import { forgotPasswordSchema } from './schema';

export default function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }

    setError(undefined);
    setSubmitting(true);
    try {
      await mockRequestPasswordReset(result.data.email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        {sent ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-primary-800">Verifique seu e-mail</h1>
            <p className="mt-2 text-sm text-slate-600">
              Se <strong>{email}</strong> estiver cadastrado, enviaremos instruções para
              redefinir sua senha.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-primary-700 hover:underline"
            >
              Voltar para o login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-xl font-bold text-primary-800">Esqueci minha senha</h1>
              <p className="mt-1 text-sm text-slate-500">
                Informe seu e-mail para receber instruções de redefinição
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Input
                label="E-mail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error}
              />
              <Button type="submit" loading={submitting} className="mt-2 w-full">
                {submitting ? 'Enviando' : 'Enviar instruções'}
              </Button>
              <Link
                href="/login"
                className="text-center text-sm text-primary-700 hover:underline"
              >
                Voltar para o login
              </Link>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
