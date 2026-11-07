import { EditAppointmentPageClient } from './EditAppointmentPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * Mesma razão de ../page.tsx (appointments sem fixtures de demo ainda) --
 * id placeholder só pra satisfazer "output: export", inalcançável pela
 * navegação normal.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: 'placeholder' }];
}

export default function EditAppointmentPage(): React.ReactElement | null {
  return <EditAppointmentPageClient />;
}
