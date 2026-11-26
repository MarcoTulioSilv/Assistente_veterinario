'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, children, className }: DrawerProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className={cn(
          'w-full max-w-lg bg-surface rounded-t-lg shadow-modal border-t border-border',
          'pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-2" />
        {title && (
          <div className="px-4 pb-2 flex items-center justify-between">
            <h2 className="text-base font-medium text-text-primary">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        )}
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
