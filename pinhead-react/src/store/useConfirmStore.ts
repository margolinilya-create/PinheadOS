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
  /**
   * Тип поля. `date` — нативный календарь: на планшете это лучший тач-ввод
   * из существующих (правило проекта — свой календарь был бы хуже).
   *
   * Заведено ради «Взять в работу» в закупке: этот путь переводил этап
   * в работу, не спрашивая план завершения, а форма цеха его требует.
   * Своя маленькая форма рядом с кнопкой стала бы вторым механизмом
   * подтверждения — в проекте он ровно один.
   */
  type?: 'text' | 'date';
  /** Что показать в поле изначально (для даты — предложение, а не пустота) */
  initialValue?: string;
}

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  prompt?: ConfirmPrompt;
  /**
   * ТРЕТИЙ ИСХОД (правка 20.09, п. 6): подпись дополнительной кнопки рядом
   * с «подтвердить» и «отмена».
   *
   * Заведён под закрытие формы заказа, где решений ровно три: сохранить
   * черновик, выйти без сохранения, продолжить заполнение. Двумя кнопками
   * это не выражается — «отмена» здесь означает «продолжить заполнение»,
   * и выйти, отказавшись от набранного, было бы нечем.
   *
   * Не путать с `variant: 'danger'`: опасность помечает ПОСЛЕДСТВИЕ главной
   * кнопки, а это — отдельный ответ.
   */
  extraLabel?: string;
}

export interface ConfirmResult {
  ok: boolean;
  /** Текст из поля ввода; пустая строка, если поля не было */
  value: string;
  /** Нажата дополнительная кнопка (`extraLabel`), а не «подтвердить» */
  extra?: boolean;
}

interface ConfirmStore {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmVariant;
  prompt: ConfirmPrompt | null;
  extraLabel: string;
  /** Растёт на каждый вызов — по нему диалог перемонтируется и поле ввода чистое */
  nonce: number;
  _resolver: ((result: ConfirmResult) => void) | null;
  show: (opts: ConfirmOptions) => Promise<ConfirmResult>;
  _close: (ok: boolean, value?: string, extra?: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'default',
  prompt: null,
  extraLabel: '',
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
        extraLabel: opts.extraLabel || '',
        _resolver: resolve,
      }));
    }),

  _close: (ok, value = '', extra = false) =>
    set((s) => {
      /**
       * `extra` попадает в результат ТОЛЬКО когда нажата третья кнопка.
       * Класть `extra: false` всегда — значит менять форму ответа у всех
       * прежних вызовов: они сравнивают результат целиком, и поле,
       * ничего не добавляющее по смыслу, ломало бы их без причины.
       */
      if (s._resolver) s._resolver(extra ? { ok, value, extra } : { ok, value });
      return { open: false, prompt: null, extraLabel: '', _resolver: null };
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

/**
 * Диалог с ТРЕМЯ исходами (правка 20.09, п. 6). Отдельная функция по той же
 * причине, что `confirmWithInput`: прежние `if (await confirm(...))` не должны
 * начать получать объект, истинный всегда.
 *
 * Возвращает 'confirm' | 'extra' | 'cancel' — словами, а не булевыми парами:
 * `{ok: false, extra: true}` на месте вызова читается как отказ, которым
 * оно не является.
 */
export function confirmThreeWay(opts: ConfirmOptions): Promise<'confirm' | 'extra' | 'cancel'> {
  return useConfirmStore.getState().show(opts).then((r) => {
    if (r.extra) return 'extra';
    return r.ok ? 'confirm' : 'cancel';
  });
}
