import { DEMO_PROPERTIES } from '@/lib/demo-fixtures';
import { EditPropertyPageClient } from './EditPropertyPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * Toda a lógica de verdade (useParams, fetch, formulário) mora inalterada
 * em EditPropertyPageClient.tsx.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return DEMO_PROPERTIES.map((property) => ({ id: property.id }));
}

export default function PropertyDetailPage(): React.ReactElement | null {
  return <EditPropertyPageClient />;
}
