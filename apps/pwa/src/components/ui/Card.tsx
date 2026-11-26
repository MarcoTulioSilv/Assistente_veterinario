import { cn } from '@/lib/cn';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface rounded-md border border-border shadow-card p-4',
        onClick && 'cursor-pointer hover:shadow-modal transition-shadow duration-150',
        className,
      )}
    >
      {children}
    </div>
  );
}
