import { cn } from '@/lib/cn';

const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-9 w-9 border-[3px]',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps): React.ReactElement {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent text-primary-700',
        SIZES[size],
        className,
      )}
    />
  );
}
