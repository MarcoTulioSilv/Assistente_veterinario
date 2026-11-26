import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
  /** Renderiza N linhas empilhadas se > 1. */
  lines?: number;
}

export function Skeleton({ className, lines = 1 }: SkeletonProps): React.ReactElement {
  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn('h-4 w-full rounded-sm bg-brand-light animate-pulse', className)} />
        ))}
      </div>
    );
  }

  return <div className={cn('h-4 w-full rounded-sm bg-brand-light animate-pulse', className)} />;
}
