// ═══════════════════════════════════════════
// Imperative confirm dialog — promise-based
// ═══════════════════════════════════════════
import { create } from 'zustand';

export type ConfirmVariant = 'default' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface ConfirmStore {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmVariant;
  _resolver: ((result: boolean) => void) | null;
  show: (opts: ConfirmOptions) => Promise<boolean>;
  _close: (result: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'default',
  _resolver: null,

  show: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: opts.title || '',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Подтвердить',
        cancelLabel: opts.cancelLabel || 'Отмена',
        variant: opts.variant || 'default',
        _resolver: resolve,
      });
    }),

  _close: (result) =>
    set((s) => {
      if (s._resolver) s._resolver(result);
      return { open: false, _resolver: null };
    }),
}));

/**
 * Show a confirmation dialog.
 * @param opts — options or a title string
 * @returns true if confirmed
 */
export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  return useConfirmStore.getState().show(o);
}
