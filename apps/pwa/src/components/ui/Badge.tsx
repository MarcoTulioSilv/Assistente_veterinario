import { cn } from '@/lib/cn';

const VARIANTS = {
  default: 'bg-brand-light text-brand-dark',
  success: 'bg-green-100 text-success',
  danger: 'bg-red-100 text-danger',
  warning: 'bg-amber-100 text-warning',
  muted: 'bg-surface-alt text-text-muted',
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
