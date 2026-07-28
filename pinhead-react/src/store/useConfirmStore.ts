// ═══════════════════════════════════════════
// Imperative confirm dialog — promise-based
// ═══════════════════════════════════════════
import { create } from 'zustand';

export type ConfirmVariant = 'default' | 'danger';

/**
 * Поле ввода внутри диалога — замена `window.prompt()`, который не стилизуется,
 * не валидируется и в части браузеров просто не показывается.
 */
export interface ConfirmPrompt {
  label: string;
  placeholder?: string;
  /** Пустой ввод не даёт подтвердить (кнопка заблокирована) */
  required?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  prompt?: ConfirmPrompt;
}

export interface ConfirmResult {
  ok: boolean;
  /** Текст из поля ввода; пустая строка, если поля не было */
  value: string;
}

interface ConfirmStore {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmVariant;
  prompt: ConfirmPrompt | null;
  /** Растёт на каждый вызов — по нему диалог перемонтируется и поле ввода чистое */
  nonce: number;
  _resolver: ((result: ConfirmResult) => void) | null;
  show: (opts: ConfirmOptions) => Promise<ConfirmResult>;
  _close: (ok: boolean, value?: string) => void;
}

export const useConfirmStore = create<ConfirmStore>((set) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'default',
  prompt: null,
  nonce: 0,
  _resolver: null,

  show: (opts) =>
    new Promise<ConfirmResult>((resolve) => {
      set((st) => ({
        open: true,
        nonce: st.nonce + 1,
        title: opts.title || '',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Подтвердить',
        cancelLabel: opts.cancelLabel || 'Отмена',
        variant: opts.variant || 'default',
        prompt: opts.prompt || null,
        _resolver: resolve,
      }));
    }),

  _close: (ok, value = '') =>
    set((s) => {
      if (s._resolver) s._resolver({ ok, value });
      return { open: false, prompt: null, _resolver: null };
    }),
}));

/**
 * Show a confirmation dialog.
 * @param opts — options or a title string
 * @returns true if confirmed
 */
export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  return useConfirmStore.getState().show(o).then((r) => r.ok);
}

/**
 * То же, но с полем ввода: возвращает и решение, и введённый текст.
 * Отдельная функция, а не расширение `confirm()`, — иначе прежние вызовы
 * `if (await confirm(...))` начали бы получать всегда истинный объект.
 */
export function confirmWithInput(opts: ConfirmOptions): Promise<ConfirmResult> {
  return useConfirmStore.getState().show(opts);
}
