/**
 * Стор Order v4 (срез 1): список заказов, открытый заказ и автосохранение.
 *
 * Автосохранение: правка ставит таймер (`SAVE_DEBOUNCE_MS`); в полёте всегда
 * не больше ОДНОГО сохранения — правка во время полёта помечает заказ
 * «грязным», и следующее сохранение уходит сразу после ответа. Так две
 * записи одного заказа не обгоняют друг друга, а последняя правка не теряется.
 * Сохраняется весь заказ целиком (до 3 позиций) — последняя запись побеждает
 * (v4 §6).
 *
 * Цена считается снаружи (`priceOrder` нужны прайс и каталоги визарда) и
 * регистрируется `setPricer`: сохранение кладёт её снимок в строку заказа.
 */
import { create } from 'zustand';
import { toast } from '../../store/useToastStore';
import {
  fetchSalesOrder, fetchSalesOrders, saveSalesOrder, salesOrderToPayload,
} from '../api/salesOrders';
import type { SalesOrderListRow } from '../api/salesOrders';
import { newSalesOrder } from '../model/factory';
import type { SalesOrder } from '../model/types';
import type { OrderPrice } from '../pricing/priceOrder';

export const SAVE_DEBOUNCE_MS = 1000;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface SalesState {
  list: SalesOrderListRow[];
  listLoading: boolean;
  current: SalesOrder | null;
  currentLoading: boolean;
  saveState: SaveState;
  loadList: () => Promise<void>;
  open: (id: string) => Promise<SalesOrder | null>;
  close: () => Promise<void>;
  /** Новый заказ сохраняется сразу — у карточки должен быть адрес */
  createNew: () => Promise<string | null>;
  edit: (fn: (o: SalesOrder) => SalesOrder) => void;
  /** Сохранить немедленно (уход с карточки, тесты) */
  flush: () => Promise<void>;
  setPricer: (fn: ((o: SalesOrder) => OrderPrice | null) | null) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let dirtyDuringFlight = false;
let pricer: ((o: SalesOrder) => OrderPrice | null) | null = null;
/**
 * Метка открытой карточки: меняется при открытии, закрытии и создании.
 * Ответ сохранения применяется к карточке, только если метка та же, —
 * а не по сравнению содержимого: правка во время создания нового заказа
 * меняет содержимое, и без метки id не дошёл бы до карточки, а следующее
 * сохранение создало бы второй заказ.
 */
let session = 0;
/** Прошлое сохранение упало — повторный сбой тоста не даёт */
let lastFailed = false;

const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

export const useSalesStore = create<SalesState>((set, get) => {
  async function runSave(): Promise<void> {
    clearTimer();
    const order = get().current;
    if (!order) return;
    if (inFlight) {
      dirtyDuringFlight = true;
      return inFlight;
    }
    dirtyDuringFlight = false;
    set({ saveState: 'saving' });
    const payload = salesOrderToPayload(order, pricer ? pricer(order) : null);
    const mySession = session;
    inFlight = (async () => {
      const res = await saveSalesOrder(payload);
      inFlight = null;
      const cur = get().current;
      // Карточку закрыли или открыли другой заказ, пока шёл запрос
      const same = mySession === session && cur != null;
      if (!res) {
        if (!lastFailed) toast.error('Не удалось сохранить заказ — правки остаются в карточке, повторим при следующей');
        lastFailed = true;
        set({ saveState: 'error' });
        return;
      }
      lastFailed = false;
      if (same && cur && !cur.id) {
        set({ current: { ...cur, id: res.id, number: res.order_number } });
      }
      if (dirtyDuringFlight) {
        await runSave();
        return;
      }
      set({ saveState: 'saved' });
    })();
    return inFlight;
  }

  return {
    list: [],
    listLoading: false,
    current: null,
    currentLoading: false,
    saveState: 'idle',

    loadList: async () => {
      set({ listLoading: true });
      const rows = await fetchSalesOrders();
      set({ listLoading: false, ...(rows ? { list: rows } : {}) });
    },

    open: async (id) => {
      if (get().current?.id === id) return get().current;
      await get().close();
      session += 1;
      set({ currentLoading: true, current: null, saveState: 'idle' });
      const order = await fetchSalesOrder(id);
      set({ currentLoading: false, current: order });
      return order;
    },

    close: async () => {
      if (timer || get().saveState === 'dirty' || get().saveState === 'error') await runSave();
      else if (inFlight) await inFlight;
      session += 1;
      set({ current: null, saveState: 'idle' });
    },

    createNew: async () => {
      await get().close();
      session += 1;
      set({ current: newSalesOrder(), saveState: 'dirty' });
      await runSave();
      const cur = get().current;
      if (!cur?.id) {
        set({ current: null, saveState: 'idle' });
        return null;
      }
      return cur.id;
    },

    edit: (fn) => {
      const cur = get().current;
      if (!cur) return;
      set({ current: fn(cur), saveState: 'dirty' });
      if (inFlight) {
        dirtyDuringFlight = true;
        return;
      }
      clearTimer();
      timer = setTimeout(() => { void runSave(); }, SAVE_DEBOUNCE_MS);
    },

    flush: async () => {
      if (timer || get().saveState === 'dirty') await runSave();
      if (inFlight) await inFlight;
    },

    setPricer: (fn) => { pricer = fn; },
  };
});

/** Сброс модульного состояния — только для тестов */
export function __resetSalesStoreForTests(): void {
  clearTimer();
  inFlight = null;
  dirtyDuringFlight = false;
  pricer = null;
  session = 0;
  lastFailed = false;
  useSalesStore.setState({ list: [], listLoading: false, current: null, currentLoading: false, saveState: 'idle' });
}
