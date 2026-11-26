import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Geralmente um <Button>. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 px-4',
        'text-center bg-surface-alt rounded-lg border border-border',
        className,
      )}
    >
      {icon && <div className="text-text-muted text-4xl">{icon}</div>}
      <p className="font-medium text-text-primary">{title}</p>
      {description && <p className="text-sm text-text-muted max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
