import { DEMO_ANIMALS } from '@/lib/demo-fixtures';
import { EditAnimalPageClient } from './EditAnimalPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * Toda a lógica de verdade (useParams, fetch, formulário) mora inalterada
 * em EditAnimalPageClient.tsx.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return DEMO_ANIMALS.map((animal) => ({ id: animal.id }));
}

export default function AnimalDetailPage(): React.ReactElement | null {
  return <EditAnimalPageClient />;
}
