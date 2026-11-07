'use client';

import { useState } from 'react';
import { Button, Input, Select, Spinner, useToast } from '@/components/ui';

/**
 * Vitrine temporária dos componentes do design system — só pra conferência
 * visual manual durante o desenvolvimento. Remover antes do merge final,
 * ou mover para Storybook se o time decidir adotar.
 */
export default function DevUiPage(): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 p-8">
      <h1 className="text-xl font-bold text-primary-800">Design system — vitrine</h1>

      <section className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        >
          {loading ? 'Carregando' : 'Simular loading'}
        </Button>
      </section>

      <section className="flex flex-col gap-4">
        <Input label="Nome do proprietário" placeholder="Ex: João Silva" hint="Como consta no documento" />
        <Input label="E-mail" type="email" defaultValue="invalido" error="E-mail inválido" />
        <Select
          label="UF da propriedade"
          placeholder="Selecione"
          options={[
            { value: 'SP', label: 'São Paulo' },
            { value: 'MG', label: 'Minas Gerais' },
          ]}
        />
      </section>

      <section className="flex items-center gap-3">
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" />
      </section>

      <section className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => toast({ title: 'Salvo com sucesso', variant: 'success' })}
        >
          Toast success
        </Button>
        <Button
          variant="outline"
          onClick={() => toast({ title: 'Falha ao salvar', description: 'Tente novamente', variant: 'error' })}
        >
          Toast error
        </Button>
        <Button variant="outline" onClick={() => toast({ title: 'Sincronizando dados' })}>
          Toast info
        </Button>
      </section>
    </main>
  );
}
