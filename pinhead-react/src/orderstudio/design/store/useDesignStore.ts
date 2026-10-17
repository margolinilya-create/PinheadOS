/**
 * Стор вкладки «Дизайн» (веха 5а, задача 5; план, решения 5 и 6).
 *
 * **Источник правды — заказ v4.** Холст ничего не хранит у себя: размещения
 * выводятся из `item.prints[].layout`, правка пишется через
 * `useSalesStore.getState().edit` (он сам — no-op не в черновике и в конечных
 * состояниях сохранения). Здесь — только привязка (заказ, позиция), вид,
 * выбор, масштаб и история undo.
 *
 * История — снимки `{ prints, flat_id }` позиции (`DesignSnapshot`), предел 50,
 * слияние правок одного ключа за 800 мс (стрелки, протяжка поля — один шаг
 * отмены; перенос DM `projectStore`). `commit(label, fn, key?)` считает правку
 * от СВЕЖИХ нанесений позиции — между действиями заказ мог измениться
 * (автосохранение, другая правка). Снимок пишется, только если заказ — черновик
 * и состояние сохранения не конечное: только чтение не копит историю.
 *
 * Все правки нанесений и флэта на вкладке — через `commit`: прямой `edit`
 * мимо стора не попал бы в историю, и откат вернул бы его назад.
 *
 * Сброс истории — смена позиции или заказа (`bind`), уход с вкладки
 * (`reset` при размонтировании) и выход (`registerAppReset`). Смена заказа
 * и сброс освобождают object URL картинок (`releaseArtworkImages`,
 * `releaseFlatImages`). Привязка ничего не пишет: открытие вкладки — без записи.
 */
import { create } from 'zustand';
import { registerAppReset } from '../../../store/appReset';
import { isTerminalSaveState, useSalesStore } from '../../store/useSalesStore';
import { isEditable } from '../../model/editable';
import type { SalesItem } from '../../model/types';
import type { DesignView } from '../types';
import { designSnapshotOf, itemOf, setItemDesign, type DesignSnapshot } from '../model/editItem';
import { releaseArtworkImages } from '../assets/artworkImages';
import { releaseFlatImages } from '../assets/flatImages';

export const HISTORY_LIMIT = 50;
export const COALESCE_MS = 800;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export interface HistoryEntry extends DesignSnapshot {
  /** Что откатывается («Логотип», «Перемещение») — для подписи «Отменить: …» */
  label: string;
}

/** Правка позиции: новые нанесения и (или) флэт; `null` — ничего не менять */
export type DesignPatch = Partial<DesignSnapshot> | null;

interface DesignState {
  orderId: string | null;
  itemKey: string | null;
  view: DesignView;
  selectedPrintKey: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  zoom: number;
  pan: { x: number; y: number };
  /** Привязать вкладку к позиции. Смена позиции или заказа сбрасывает историю */
  bind: (orderId: string | null, itemKey: string | null) => void;
  select: (printKey: string | null) => void;
  setView: (view: DesignView) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  /** Можно ли сейчас править: привязка жива, заказ — черновик, сохранение не в конечном состоянии */
  canEdit: () => boolean;
  /** Правка позиции через `edit` со снимком истории. `false` — ничего не записано */
  commit: (label: string, fn: (item: SalesItem) => DesignPatch, coalesceKey?: string) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Уход с вкладки и выход: привязка, история, картинки */
  reset: () => void;
}

const INITIAL = {
  orderId: null,
  itemKey: null,
  view: 'front' as DesignView,
  selectedPrintKey: null,
  past: [] as HistoryEntry[],
  future: [] as HistoryEntry[],
  zoom: 1,
  pan: { x: 0, y: 0 },
};

/** Слияние истории: ключ и время последней правки (вне состояния — не рисуется) */
let lastKey: string | null = null;
let lastAt = 0;

/** Позиция, которую можно править сейчас; иначе `null` */
function editableItem(orderId: string | null, itemKey: string | null): SalesItem | null {
  const { current, saveState } = useSalesStore.getState();
  if (!current || !orderId || !itemKey || isTerminalSaveState(saveState) || !isEditable(current)) return null;
  // Карточка уже другого заказа (переход, перечитывание) — правка не туда не уходит
  if (current.id !== orderId) return null;
  return itemOf(current, itemKey);
}

/** Выбор переживает откат, только если нанесение осталось */
function keepSelection(selected: string | null, snap: DesignSnapshot): string | null {
  return selected && snap.prints.some((p) => p.key === selected) ? selected : null;
}

export const useDesignStore = create<DesignState>((set, get) => {
  /** Записать снимок в позицию; откат/возврат — та же запись, что и правка */
  function write(itemKey: string, snap: DesignSnapshot): void {
    useSalesStore.getState().edit((o) => setItemDesign(o, itemKey, snap));
  }

  /** Шаг по истории: из `from` в позицию, текущее — в `to` */
  function step(from: 'past' | 'future'): boolean {
    const s = get();
    const stack = s[from];
    const item = editableItem(s.orderId, s.itemKey);
    if (!item || stack.length === 0) return false;
    const entry = from === 'past' ? stack[stack.length - 1] : stack[0];
    const current: HistoryEntry = { ...designSnapshotOf(item), label: entry.label };
    lastKey = null;
    write(item.key, entry);
    const selectedPrintKey = keepSelection(s.selectedPrintKey, entry);
    set(from === 'past'
      ? { past: stack.slice(0, -1), future: [current, ...s.future].slice(0, HISTORY_LIMIT), selectedPrintKey }
      : { future: stack.slice(1), past: [...s.past, current].slice(-HISTORY_LIMIT), selectedPrintKey });
    return true;
  }

  return {
    ...INITIAL,

    bind: (orderId, itemKey) => {
      const s = get();
      if (s.orderId === orderId && s.itemKey === itemKey) return;
      // Картинки — кэш на заказ: другой заказ — освободить object URL прежнего
      if (s.orderId !== null && s.orderId !== orderId) releaseArtworkImages();
      lastKey = null;
      set({ ...INITIAL, orderId, itemKey });
    },

    select: (printKey) => set({ selectedPrintKey: printKey }),
    setView: (view) => set({ view, selectedPrintKey: null }),
    setZoom: (zoom) => set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1)) }),
    setPan: (pan) => set({ pan: { x: pan.x, y: pan.y } }),

    canEdit: () => {
      const s = get();
      return editableItem(s.orderId, s.itemKey) !== null;
    },

    commit: (label, fn, coalesceKey) => {
      const s = get();
      const item = editableItem(s.orderId, s.itemKey);
      if (!item) return false;
      const patch = fn(item);
      const prints = patch?.prints ?? item.prints;
      const flatId = patch?.flat_id ?? item.flat_id;
      if (prints === item.prints && flatId === item.flat_id) return false;
      const now = Date.now();
      const merge = coalesceKey !== undefined && coalesceKey === lastKey && now - lastAt < COALESCE_MS;
      set({
        past: merge ? s.past : [...s.past, { ...designSnapshotOf(item), label }].slice(-HISTORY_LIMIT),
        future: [],
      });
      lastKey = coalesceKey ?? null;
      lastAt = now;
      write(item.key, { prints, flat_id: flatId });
      return true;
    },

    undo: () => step('past'),
    redo: () => step('future'),

    reset: () => {
      lastKey = null;
      releaseArtworkImages();
      releaseFlatImages();
      set({ ...INITIAL });
    },
  };
});

registerAppReset(() => useDesignStore.getState().reset());
