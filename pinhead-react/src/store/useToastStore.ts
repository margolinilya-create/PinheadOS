import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Сколько раз пришло одно и то же сообщение, пока оно висит на экране */
  count: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (message: string, type?: ToastType) => void;
  remove: (id: number) => void;
}

/** Сколько сообщение живёт на экране */
export const TOAST_TTL_MS = 3000;

/**
 * Сколько полос показываем одновременно. Больше — это уже не уведомление,
 * а перекрытый экран: при системном сбое каждый из десяти экранов сообщает
 * о своей неудаче, и все сообщения разные.
 */
const MAX_TOASTS = 4;


/**
 * Идентификатор — счётчик, а не `Date.now()`.
 *
 * Два сообщения в одну миллисекунду получали ОДИН id, и `remove` гасил оба:
 * человек закрывал одну ошибку, а исчезали две. При системном сбое, когда
 * сообщения приходят пачкой, это происходило регулярно.
 */
let nextId = 0;

/** Таймеры автоскрытия по id — повтор сообщения продлевает жизнь существующему */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => {
  const scheduleRemoval = (id: number) => {
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_TTL_MS));
  };

  return {
    toasts: [],

    /**
     * Одинаковые сообщения не копятся, а считаются.
     *
     * Один системный сбой — например, оборвавшаяся связь — доходит до человека
     * десятком экранов сразу: список заказов, доска, очередь, дашборд и остальные
     * читают общий флаг загрузки и каждый показывает свою красную полосу. Заказчик
     * просил прямо: «не показывать россыпь одинаковых красных ошибок при одном
     * системном сбое». Повтор продлевает жизнь уже висящему сообщению и добавляет
     * к нему счётчик.
     */
    add: (message, type = 'success') => {
      const same = get().toasts.find((t) => t.message === message && t.type === type);
      if (same) {
        set((s) => ({
          toasts: s.toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t)),
        }));
        scheduleRemoval(same.id);
        return;
      }
      const id = (nextId += 1);
      set((s) => {
        const next = [...s.toasts, { id, message, type, count: 1 }];
        /*
         * Потолок числа полос. Счётчик одинаковых сообщений эту задачу решает
         * только наполовину: `erpError` подставляет в текст ИМЯ ДЕЙСТВИЯ,
         * поэтому при одном обрыве связи сообщения получаются разные —
         * «Не удалось загрузить заказ: нет связи», «…архив», «…комментарии»,
         * «…историю правок», «Этап не обновлён», — и дедуп по полному тексту
         * не срабатывает ни разу. Прогон оффлайна дал 11 полос сразу; потолка
         * не было вовсе, то есть 100 разных ошибок дали бы 100 полос
         * и перекрыли бы экран целиком.
         *
         * Вытесняем САМЫЕ СТАРЫЕ: свежие сообщения относятся к тому, что
         * человек делает прямо сейчас. Их таймеры снимаются, иначе останутся
         * висеть и попробуют убрать уже удалённые полосы.
         */
        if (next.length <= MAX_TOASTS) return { toasts: next };
        for (const dropped of next.slice(0, next.length - MAX_TOASTS)) {
          const timer = timers.get(dropped.id);
          if (timer) clearTimeout(timer);
          timers.delete(dropped.id);
        }
        return { toasts: next.slice(-MAX_TOASTS) };
      });
      scheduleRemoval(id);
    },

    remove: (id) => {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

export const toast = {
  success: (msg: string) => useToastStore.getState().add(msg, 'success'),
  error: (msg: string) => useToastStore.getState().add(msg, 'error'),
  warning: (msg: string) => useToastStore.getState().add(msg, 'warning'),
};
