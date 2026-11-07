import { AppointmentDetailPageClient } from './AppointmentDetailPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * api.demo.ts ainda não implementa appointments (ver AppHeader.tsx, que
 * esconde o link "Atendimentos" na demo por isso) -- sem id de demo pra
 * pré-gerar. "output: export" exige pelo menos uma rota gerada, daí o id
 * placeholder, inalcançável pela navegação normal (sem link pra ele).
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: 'placeholder' }];
}

export default function AppointmentDetailPage(): React.ReactElement | null {
  return <AppointmentDetailPageClient />;
}
