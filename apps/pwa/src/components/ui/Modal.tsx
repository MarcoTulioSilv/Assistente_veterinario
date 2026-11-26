'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          'relative w-full max-w-lg bg-surface rounded-lg shadow-modal border border-border p-6',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-text-primary">{title}</h2>
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
        {children}
      </div>
    </div>
  );
}
