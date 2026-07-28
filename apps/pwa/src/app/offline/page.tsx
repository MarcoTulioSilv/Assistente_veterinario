export const metadata = { title: 'Sem conexão — VetEquine' };

export default function OfflinePage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold text-slate-800">Sem conexão</h1>
      <p className="max-w-md text-slate-600">
        Você está offline. As fichas já carregadas continuam disponíveis para consulta — novos
        registros serão sincronizados assim que a conexão voltar.
      </p>
      <a href="/" className="rounded bg-slate-800 px-4 py-2 text-white">
        Tentar novamente
      </a>
    </main>
  );
}
