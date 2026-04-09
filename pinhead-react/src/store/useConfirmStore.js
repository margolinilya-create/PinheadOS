// ═══════════════════════════════════════════
// Imperative confirm dialog — promise-based
// Usage:
//   import { confirm } from '../store/useConfirmStore';
//   if (await confirm({ title: 'Удалить?', variant: 'danger' })) { ... }
// ═══════════════════════════════════════════
import { create } from 'zustand';

export const useConfirmStore = create((set) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'default',
  _resolver: null,

  show: (opts) => new Promise((resolve) => {
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

  _close: (result) => set((s) => {
    if (s._resolver) s._resolver(result);
    return { open: false, _resolver: null };
  }),
}));

/**
 * Show a confirmation dialog.
 * @param {object|string} opts — options or a title string
 * @returns {Promise<boolean>} — true if confirmed
 */
export function confirm(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  return useConfirmStore.getState().show(o);
}
