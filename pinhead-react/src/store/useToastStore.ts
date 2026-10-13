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

/**
 * Сколько сообщение живёт на экране.
 *
 * У ОТКАЗА времени больше, чем у успеха (правка 03.09, решение владельца).
 * Три секунды одинаково для обоих — это ровно то время, за которое рабочий
 * не успевает поднять голову от изделия: успех он и так видит по изменившемуся
 * экрану, а отказ — ЕДИНСТВЕННЫЙ канал, которым `erpError` объясняет причину
 * (нет прав, обрыв связи, конфликт). Пропущенное сообщение об отказе означает
 * «нажал — ничего не произошло», и человек нажимает ещё раз.
 *
 * Предупреждение живёт столько же, сколько ошибка: «Блокировка записана,
 * но фото не загрузилось» — это тоже то, что нужно успеть прочитать.
 */
export const TOAST_TTL_MS = 3000;
export const TOAST_ERROR_TTL_MS = 8000;

/** Время жизни по типу сообщения */
export function toastTtl(type: ToastType): number {
  return type === 'success' ? TOAST_TTL_MS : TOAST_ERROR_TTL_MS;
}

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
  const scheduleRemoval = (id: number, type: ToastType) => {
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toastTtl(type)));
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
        scheduleRemoval(same.id, type);
        return;
      }
      const id = (nextId += 1);
      set((s) => ({ toasts: [...s.toasts, { id, message, type, count: 1 }] }));
      scheduleRemoval(id, type);
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
