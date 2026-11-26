import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

const VARIANTS = {
  primary: 'bg-brand-dark text-brand-light hover:bg-[#3d1f14] focus-visible:ring-brand-dark',
  secondary:
    'bg-brand-light text-brand-dark border border-border hover:bg-[#f0dece] focus-visible:ring-brand-dark',
  // Variante sem spec de marca -- mantida como estava (cor e ring próprios),
  // só a cor do ring deixou de vir do padrão genérico do base (que agora
  // varia por variante) para não perder o anel de foco.
  outline:
    'border border-primary-700 text-primary-700 hover:bg-primary-50 focus-visible:ring-primary-500 disabled:border-slate-300 disabled:text-slate-400',
  danger: 'bg-danger text-white hover:bg-[#a93226] focus-visible:ring-danger',
  ghost: 'bg-transparent text-brand-dark hover:bg-brand-light focus-visible:ring-brand-dark',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none',
        'active:scale-[0.97]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={size === 'lg' ? 'md' : 'sm'} className="text-current" />}
      {children}
    </button>
  );
});
