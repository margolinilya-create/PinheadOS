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
 *
 * Версия заказа (миграция D): `current.updated_at` приходит с чтением карточки
 * и обновляется ответом каждого сохранения; следующее сохранение шлёт её как
 * `expected_updated_at`.
 *
 * Состояния сохранения (веха 3). `clean` → `dirty` → `saving` → `clean`;
 * `error` — обычный сбой (сеть, RLS): правки остаются, повтор при следующей
 * правке и при уходе. Три КОНЕЧНЫХ состояния повтор не лечит, поэтому в них
 * правка — no-op, таймер не ставится и запись не уходит:
 * - `locked` — заказ не черновик (открыт таким или сервер ответил стражем);
 *   после отказа заказ перечитывается один раз, карточка показывает версию сервера;
 * - `outdated` — вкладка старше сервера: поднимается плашка «Вышло обновление»;
 * - `conflict` — заказ сохранили из другой вкладки: правки остаются в карточке,
 *   заказ перечитывается один раз — если он уже не черновик, это `locked`.
 * Текст отказа сервера показывается тостом один раз — конечное состояние
 * не даёт второй записи. Флаг «первый сбой уже показан» — только у `error`.
 *
 * Ответы RPC переходов и оплаты (веха 6+7, К19) кладёт `applyServer`: статус,
 * оплата и НОВАЯ версия строки — иначе следующее сохранение ушло бы со старым
 * `expected_updated_at` и получило ложный `conflict`. Не черновик — `locked`;
 * возврат в черновик снимает только `locked` (`outdated`/`conflict` остаются).
 * Ответ без версии (сервер старше миграции J) полей не кладёт — заказ
 * перечитывается.
 *
 * Отправка в работу (`beginSend` … `endSend`): на всё время цепочки правка
 * закрыта (`edit` — no-op), путь PDF ТЗ пишет только держатель знака отправки
 * через `editDuringSend` — правка человека не перемешается с отправляемым ТЗ.
 *
 * Сервер знает `zone_id` и `notes` (веха 8, миграция K; К5) — `serverHasNotes`:
 * ставится ответом сохранения с ключом `notes` или чтением заказа (метку ставит
 * `fetchSalesOrder`). Пока ложно, payload этих полей не несёт и поле
 * «Комментарий для цехов» скрыто: старый сервер молча их пропустил бы.
 * Это свойство сервера, а не пользователя, — выход признак не снимает.
 *
 * Выход (`runAppResets`) обнуляет всё: таймер, полёт, карточку и список —
 * следующий пользователь той же вкладки не видит чужого заказа, а отложенное
 * сохранение прежнего не уходит под новой сессией.
 */
import { create } from 'zustand';
import { toast } from '../../store/useToastStore';
import { registerAppReset } from '../../store/appReset';
import { useAppUpdateStore } from '../../store/useAppUpdateStore';
import {
  fetchSalesOrder, fetchSalesOrders, saveSalesOrder, salesOrderToPayload,
} from '../api/salesOrders';
import { markServerZoneNotes, serverKnowsZoneNotes, __resetServerZoneNotesForTests } from '../api/serverZoneNotes';
import type { SalesOrderListRow, SaveFailure } from '../api/salesOrders';
import { newSalesOrder } from '../model/factory';
import { isEditable } from '../model/editable';
import type { SalesOrder } from '../model/types';
import type { OrderPrice } from '../pricing/priceOrder';

export const SAVE_DEBOUNCE_MS = 1000;

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error' | 'locked' | 'outdated' | 'conflict';

type TerminalState = Exclude<SaveFailure, 'other'>;

/** Конечные состояния: повтор записи даст тот же отказ — сохранение остановлено */
export function isTerminalSaveState(s: SaveState): s is TerminalState {
  return s === 'locked' || s === 'outdated' || s === 'conflict';
}

/** Если сервер прислал отказ без текста — что сказать человеку */
const TERMINAL_FALLBACK: Record<TerminalState, string> = {
  locked: 'Заказ отправлен в работу — правка закрыта',
  outdated: 'Вышло обновление — обновите страницу, правка не сохранена',
  conflict: 'Заказ изменён в другой вкладке — обновите страницу',
};

/** Поля, которые возвращают RPC переходов и оплаты (миграция J) */
export type ServerPatch = Partial<Pick<SalesOrder,
  'status' | 'updated_at' | 'erp_order_id' | 'sent_at' | 'paid_kind' | 'paid_at' | 'paid_override_reason' | 'launched_at'
>> & { id: string };

const SERVER_FIELDS = [
  'status', 'updated_at', 'erp_order_id', 'sent_at', 'paid_kind', 'paid_at', 'paid_override_reason', 'launched_at',
] as const;

export interface OpenOptions {
  /** Перечитать заказ, даже если он уже открыт (после отказа сервера) */
  force?: boolean;
}

interface SalesState {
  list: SalesOrderListRow[];
  listLoading: boolean;
  current: SalesOrder | null;
  currentLoading: boolean;
  saveState: SaveState;
  /** Идёт «Отправить в работу»: правка закрыта (`edit` — no-op) */
  sending: boolean;
  /** Сервер знает `zone_id` нанесения и `notes` заказа (миграция K) */
  serverHasNotes: boolean;
  loadList: () => Promise<void>;
  open: (id: string, opts?: OpenOptions) => Promise<SalesOrder | null>;
  close: () => Promise<void>;
  /**
   * Новый заказ сохраняется сразу — у карточки должен быть адрес.
   * `seed` — готовое содержимое («Оформить как заказ v4» из визарда главной)
   */
  createNew: (seed?: Partial<SalesOrder>) => Promise<string | null>;
  /** Правка открытого заказа. Не черновик или конечное состояние — no-op */
  edit: (fn: (o: SalesOrder) => SalesOrder) => void;
  /** Сохранить немедленно (уход с карточки, тесты) */
  flush: () => Promise<void>;
  setPricer: (fn: ((o: SalesOrder) => OrderPrice | null) | null) => void;
  /**
   * Ответ RPC перехода или оплаты. Чужой id — no-op; нет `updated_at` —
   * заказ перечитывается вместо полей
   */
  applyServer: (patch: ServerPatch) => void;
  /** Начало отправки открытого заказа: знак для `editDuringSend` либо `null` (не тот заказ, уже идёт) */
  beginSend: (id: string) => number | null;
  /** Конец отправки (успех или отказ): правка снова открыта */
  endSend: () => void;
  /** Правка во время отправки — только держателю знака; `false` — не записано */
  editDuringSend: (token: number, fn: (o: SalesOrder) => SalesOrder) => boolean;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let dirtyDuringFlight = false;
let pricer: ((o: SalesOrder) => OrderPrice | null) | null = null;
/**
 * Метка открытой карточки: меняется при открытии, закрытии, создании и выходе.
 * Ответ сохранения применяется к карточке, только если метка та же, —
 * а не по сравнению содержимого: правка во время создания нового заказа
 * меняет содержимое, и без метки id не дошёл бы до карточки, а следующее
 * сохранение создало бы второй заказ.
 */
let session = 0;
/**
 * Метка «карточку открыли снова». `close()` ждёт сохранения несохранённой
 * правки; если за это время тот же заказ открыли снова (StrictMode
 * перемонтирует карточку, возврат из визарда позиции), закрытие не должно
 * обнулить уже открытую карточку — иначе «Заказ не найден» (поймано обходом
 * в браузере). Отдельно от `session`: та решает, чей ответ сохранения
 * применять, и её сдвиг здесь потерял бы id нового заказа.
 */
let reopened = 0;
/**
 * Метка выхода: ответ списка, запрошенного прежним пользователем, не должен
 * лечь в стор нового. Отдельно от `session` — та сдвигается каждым открытием
 * карточки, и список, загружаемый рядом, терялся бы зря.
 */
let epoch = 0;
/** Прошлое сохранение упало обычным сбоем (`error`) — повторный тоста не даёт */
let lastFailed = false;
/** Знак текущей отправки (0 — отправки нет); растёт, чтобы старый знак не подошёл */
let sendSeq = 0;
let sendToken = 0;

const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

export const useSalesStore = create<SalesState>((set, get) => {
  /**
   * После отказа `conflict` — один раз перечитать заказ: если его уже
   * отправили в работу, правка закрыта навсегда (`locked`, версия сервера);
   * иначе остаётся `conflict` с правками человека в карточке — их не
   * затираем, решение «обновить страницу» за ним.
   */
  async function recheckConflict(id: string, mySession: number): Promise<void> {
    const fresh = await fetchSalesOrder(id);
    if (mySession !== session || !fresh || isEditable(fresh)) return;
    set({ current: fresh, saveState: 'locked' });
  }

  async function onTerminal(kind: TerminalState, message: string, id: string | null, mySession: number) {
    dirtyDuringFlight = false;
    toast.error(message || TERMINAL_FALLBACK[kind]);
    set({ saveState: kind });
    if (kind === 'outdated') {
      useAppUpdateStore.getState().markAvailable();
    } else if (id && kind === 'locked') {
      // Заказ отправили в работу, пока он был открыт: показать версию сервера
      await get().open(id, { force: true });
    } else if (id) {
      await recheckConflict(id, mySession);
    }
  }

  async function runSave(): Promise<void> {
    clearTimer();
    const order = get().current;
    if (!order || isTerminalSaveState(get().saveState) || !isEditable(order)) return;
    if (inFlight) {
      dirtyDuringFlight = true;
      return inFlight;
    }
    dirtyDuringFlight = false;
    set({ saveState: 'saving' });
    const payload = salesOrderToPayload(order, pricer ? pricer(order) : null, { zoneNotes: get().serverHasNotes });
    const mySession = session;
    // Полёт обнуляет только СВОЮ ссылку: после выхода (`runAppResets`) ответ
    // запроса, ушедшего до сброса, иначе затёр бы ссылку на новое сохранение,
    // и следующая правка ушла бы параллельным RPC
    let myFlight: Promise<void> | null = null;
    myFlight = (async () => {
      const res = await saveSalesOrder(payload);
      if (inFlight === myFlight) inFlight = null;
      // Карточку закрыли, открыли другой заказ или вышли, пока шёл запрос:
      // ответ ничей — ни тоста, ни состояния
      if (mySession !== session) return;
      const cur = get().current;
      if (!res.ok) {
        if (res.kind !== 'other') {
          await onTerminal(res.kind, res.message, cur?.id ?? null, mySession);
          return;
        }
        if (!lastFailed) {
          toast.error(cur?.id
            ? 'Не удалось сохранить заказ — правки остаются в карточке, повторим при следующей правке'
            : 'Не удалось создать заказ — проверьте связь и попробуйте ещё раз');
        }
        lastFailed = true;
        set({ saveState: 'error' });
        return;
      }
      lastFailed = false;
      const saved = res.saved;
      if (typeof saved.notes === 'string') {
        markServerZoneNotes();
        if (!get().serverHasNotes) set({ serverHasNotes: true });
      }
      // Новая версия строки — основа следующего сохранения; у нового заказа ещё id и номер
      if (cur && (!cur.id || cur.id === saved.id)) {
        set({
          current: cur.id
            ? { ...cur, updated_at: saved.updated_at }
            : { ...cur, id: saved.id, number: saved.order_number, updated_at: saved.updated_at },
        });
      }
      if (dirtyDuringFlight) {
        await runSave();
        return;
      }
      set({ saveState: 'clean' });
    })();
    inFlight = myFlight;
    return myFlight;
  }

  /** Правка карточки и таймер сохранения — общее у `edit` и `editDuringSend` */
  function applyEdit(cur: SalesOrder, fn: (o: SalesOrder) => SalesOrder): void {
    set({ current: fn(cur), saveState: 'dirty' });
    if (inFlight) {
      dirtyDuringFlight = true;
      return;
    }
    clearTimer();
    timer = setTimeout(() => { void runSave(); }, SAVE_DEBOUNCE_MS);
  }

  return {
    list: [],
    listLoading: false,
    current: null,
    currentLoading: false,
    saveState: 'clean',
    sending: false,
    serverHasNotes: serverKnowsZoneNotes(),

    loadList: async () => {
      const myEpoch = epoch;
      set({ listLoading: true });
      const rows = await fetchSalesOrders();
      if (myEpoch !== epoch) return;
      set({ listLoading: false, ...(rows ? { list: rows } : {}) });
    },

    open: async (id, opts) => {
      if (!opts?.force && get().current?.id === id) {
        reopened += 1;
        return get().current;
      }
      await get().close();
      session += 1;
      const mySession = session;
      sendToken = 0;
      set({ currentLoading: true, current: null, saveState: 'clean', sending: false });
      const order = await fetchSalesOrder(id);
      // Пока шёл запрос, карточку закрыли или открыли другую — ответ устарел
      if (mySession !== session) return null;
      // Не черновик — «только чтение» сразу: правка закрыта и сервером
      set({
        currentLoading: false, current: order, saveState: order && !isEditable(order) ? 'locked' : 'clean',
        serverHasNotes: get().serverHasNotes || serverKnowsZoneNotes(),
      });
      return order;
    },

    close: async () => {
      const mark = reopened;
      if (timer || get().saveState === 'dirty' || get().saveState === 'error') {
        // Закрытие — последний шанс: о сбое говорим всегда, даже если прошлый
        // тост уже был, иначе правки пропадают молча
        lastFailed = false;
        await runSave();
      } else if (inFlight) await inFlight;
      if (mark !== reopened) return;
      session += 1;
      sendToken = 0;
      set({ current: null, currentLoading: false, saveState: 'clean', sending: false });
    },

    createNew: async (seed) => {
      await get().close();
      session += 1;
      set({ current: newSalesOrder(seed), saveState: 'dirty' });
      await runSave();
      const cur = get().current;
      if (!cur?.id) {
        set({ current: null, saveState: 'clean' });
        return null;
      }
      return cur.id;
    },

    edit: (fn) => {
      const { current: cur, saveState, sending } = get();
      if (!cur || sending || isTerminalSaveState(saveState) || !isEditable(cur)) return;
      applyEdit(cur, fn);
    },

    flush: async () => {
      const st = get().saveState;
      if (timer || st === 'dirty' || st === 'error') await runSave();
      if (inFlight) await inFlight;
    },

    setPricer: (fn) => { pricer = fn; },

    applyServer: (patch) => {
      const cur = get().current;
      if (!cur || !cur.id || cur.id !== patch.id) return;
      if (!patch.updated_at) {
        // Сервер старше J: версии нет — класть поля нельзя (следующее
        // сохранение ушло бы со старой версией), перечитываем заказ целиком
        void get().open(cur.id, { force: true });
        return;
      }
      const fields: Partial<SalesOrder> = {};
      for (const k of SERVER_FIELDS) {
        if (k in patch) (fields as Record<string, unknown>)[k] = patch[k];
      }
      const next = { ...cur, ...fields };
      const prev = get().saveState;
      let saveState = prev;
      if (!isEditable(next)) {
        clearTimer();
        dirtyDuringFlight = false;
        saveState = 'locked';
      } else if (prev === 'locked') {
        saveState = 'clean';
      }
      set({ current: next, saveState });
    },

    beginSend: (id) => {
      const { current: cur, sending } = get();
      if (!cur || cur.id !== id || sending) return null;
      sendSeq += 1;
      sendToken = sendSeq;
      set({ sending: true });
      return sendToken;
    },

    endSend: () => {
      sendToken = 0;
      set({ sending: false });
    },

    editDuringSend: (token, fn) => {
      const { current: cur, saveState, sending } = get();
      if (!cur || !sending || token === 0 || token !== sendToken) return false;
      if (isTerminalSaveState(saveState) || !isEditable(cur)) return false;
      applyEdit(cur, fn);
      return true;
    },
  };
});

/**
 * Сброс при выходе и потере сессии. Полёт не отменить, но его ответ ничей:
 * `session` сдвинута, и `runSave` его отбросит; правка, отложенная таймером,
 * не уйдёт вовсе. `pricer` не трогаем — его держит смонтированный экран.
 */
function resetSalesStore(): void {
  clearTimer();
  inFlight = null;
  dirtyDuringFlight = false;
  lastFailed = false;
  sendToken = 0;
  session += 1;
  epoch += 1;
  useSalesStore.setState({
    list: [], listLoading: false, current: null, currentLoading: false, saveState: 'clean', sending: false,
  });
}

registerAppReset(resetSalesStore);

/** Сброс модульного состояния — только для тестов */
export function __resetSalesStoreForTests(): void {
  resetSalesStore();
  __resetServerZoneNotesForTests();
  useSalesStore.setState({ serverHasNotes: false });
  pricer = null;
  session = 0;
  epoch = 0;
  reopened = 0;
  sendSeq = 0;
}
