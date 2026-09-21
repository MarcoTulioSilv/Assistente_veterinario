import { DEMO_OWNERS } from '@/lib/demo-fixtures';
import { EditOwnerPageClient } from './EditOwnerPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * Toda a lógica de verdade (useParams, fetch, formulário) mora inalterada
 * em EditOwnerPageClient.tsx.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return DEMO_OWNERS.map((owner) => ({ id: owner.id }));
}

export default function OwnerDetailPage(): React.ReactElement | null {
  return <EditOwnerPageClient />;
}
