import { DEMO_PRODUCTS } from '@/lib/demo-fixtures';
import { EditProductPageClient } from './EditProductPageClient';

/**
 * Server Component "casca" -- generateStaticParams() só pode existir aqui
 * (nunca num arquivo 'use client', ver next.config.ts output:'export').
 * Toda a lógica de verdade (useParams, fetch, formulário, ledger de
 * movimentações) mora inalterada em EditProductPageClient.tsx.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return DEMO_PRODUCTS.map((product) => ({ id: product.id }));
}

export default function ProductDetailPage(): React.ReactElement | null {
  return <EditProductPageClient />;
}
