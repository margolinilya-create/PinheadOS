import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSalesStore, __resetSalesStoreForTests, SAVE_DEBOUNCE_MS } from './useSalesStore';
import { runAppResets } from '../../store/appReset';
import { useAppUpdateStore } from '../../store/useAppUpdateStore';
import { newSalesOrder } from '../model/factory';
import type { SalesOrderStatus } from '../model/types';

const api = vi.hoisted(() => ({
  fetchSalesOrders: vi.fn(),
  fetchSalesOrder: vi.fn(),
  saveSalesOrder: vi.fn(),
}));

vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig<typeof import('../api/salesOrders')>()),
  ...api,
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../store/useToastStore', () => ({ toast }));

/** Ответ сохранения, который тест отпускает сам */
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const ok = (id = 'o-1', updated_at = 'now') => ({ ok: true, saved: { id, order_number: 'PH-0001', updated_at } });
const fail = (kind = 'other', message = 'сеть') => ({ ok: false, kind, message });

beforeEach(() => {
  __resetSalesStoreForTests();
  vi.useFakeTimers();
  Object.values(api).forEach((f) => f.mockReset());
  toast.error.mockReset();
  useAppUpdateStore.setState({ available: false, snoozedUntil: 0 });
});
afterEach(() => { vi.useRealTimers(); });

const open = (id = 'o-1', updated_at: string | null = null, status: SalesOrderStatus = 'draft') => {
  api.fetchSalesOrder.mockResolvedValueOnce(newSalesOrder({ id, title: 'A', updated_at, status }));
  return useSalesStore.getState().open(id);
};

describe('useSalesStore — автосохранение', () => {
  it('серия правок — одно сохранение после паузы, с последним значением', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValue(ok());
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    edit((o) => ({ ...o, title: 'C' }));
    expect(useSalesStore.getState().saveState).toBe('dirty');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(api.saveSalesOrder).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(api.saveSalesOrder.mock.calls[0][0].title).toBe('C');
    expect(useSalesStore.getState().saveState).toBe('clean');
  });

  it('правка во время полёта — второе сохранение сразу после ответа, не параллельно', async () => {
    await open();
    const first = deferred();
    api.saveSalesOrder.mockReturnValueOnce(first.promise).mockResolvedValue(ok());
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    first.resolve(ok());
    await vi.runAllTimersAsync();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);
    expect(api.saveSalesOrder.mock.calls[1][0].title).toBe('C');
    expect(useSalesStore.getState().saveState).toBe('clean');
  });

  it('сбой — статус «ошибка», тост один раз, правки остаются в карточке', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValue(fail());
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('error');
    expect(useSalesStore.getState().current?.title).toBe('C');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('снимок цены берётся из зарегистрированного расчёта', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValue(ok());
    useSalesStore.getState().setPricer(() => ({ total: 777, margin_pct: 0.2, items: [] }) as never);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder.mock.calls[0][0]).toMatchObject({ price_total: 777, price_margin_pct: 0.2 });
  });
});

describe('useSalesStore — создание и закрытие', () => {
  it('новый заказ сохраняется сразу и получает id', async () => {
    api.saveSalesOrder.mockResolvedValue(ok('new-1'));
    const id = await useSalesStore.getState().createNew();
    expect(id).toBe('new-1');
    expect(api.saveSalesOrder.mock.calls[0][0].id).toBeNull();
    expect(useSalesStore.getState().current).toMatchObject({ id: 'new-1', number: 'PH-0001' });
  });

  it('правка во время создания не рождает второй заказ', async () => {
    const first = deferred();
    api.saveSalesOrder.mockReturnValueOnce(first.promise).mockResolvedValue(ok('new-1'));
    const created = useSalesStore.getState().createNew();
    // Карточка появляется, когда уже ушло создание — правка приходит в полёте
    while (api.saveSalesOrder.mock.calls.length === 0) await Promise.resolve();
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    first.resolve(ok('new-1'));
    await created;
    await vi.runAllTimersAsync();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);
    expect(api.saveSalesOrder.mock.calls[1][0]).toMatchObject({ id: 'new-1', title: 'B' });
  });

  it('создание с готовым содержимым: засеянный заказ уходит первой записью', async () => {
    api.saveSalesOrder.mockResolvedValue(ok('new-1'));
    await useSalesStore.getState().createNew({ customer: 'ООО Ромашка', urgent: true });
    expect(api.saveSalesOrder.mock.calls[0][0]).toMatchObject({ id: null, customer: 'ООО Ромашка', urgent: true });
    expect(useSalesStore.getState().current).toMatchObject({ id: 'new-1', customer: 'ООО Ромашка' });
  });

  it('сбой создания — карточки нет, null', async () => {
    api.saveSalesOrder.mockResolvedValue(fail());
    expect(await useSalesStore.getState().createNew()).toBeNull();
    expect(useSalesStore.getState().current).toBeNull();
  });

  it('закрытие с несохранённой правкой сохраняет её, не дожидаясь паузы', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValue(ok());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await useSalesStore.getState().close();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(useSalesStore.getState().current).toBeNull();
  });

  it('закрытие с правкой и повторное открытие того же заказа — карточка остаётся открытой', async () => {
    await open('o-1');
    const save = deferred();
    api.saveSalesOrder.mockReturnValueOnce(save.promise);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    const closing = useSalesStore.getState().close();
    await useSalesStore.getState().open('o-1');
    save.resolve(ok());
    await closing;
    expect(useSalesStore.getState().current).toMatchObject({ id: 'o-1', title: 'B' });
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(1);
  });

  it('открытие другого заказа сохраняет правки прежнего', async () => {
    await open('o-1');
    api.saveSalesOrder.mockResolvedValue(ok());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await open('o-2');
    expect(api.saveSalesOrder.mock.calls[0][0]).toMatchObject({ id: 'o-1', title: 'B' });
    expect(useSalesStore.getState().current?.id).toBe('o-2');
  });
});

describe('useSalesStore — правки не теряются после сбоя', () => {
  it('закрытие после сбоя повторяет сохранение и снова говорит о сбое', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValue(fail());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('error');
    expect(toast.error).toHaveBeenCalledTimes(1);
    await useSalesStore.getState().close();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('flush после сбоя повторяет сохранение', async () => {
    await open();
    api.saveSalesOrder.mockResolvedValueOnce(fail()).mockResolvedValue(ok());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('error');
    await useSalesStore.getState().flush();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);
    expect(useSalesStore.getState().saveState).toBe('clean');
  });
});

describe('useSalesStore — версия заказа и отказы сервера (миграция D)', () => {
  const OUTDATED = 'Вышло обновление — обновите страницу, правка не сохранена';
  const CONFLICT = 'Заказ изменён в другой вкладке — обновите страницу';

  it('открытый заказ шлёт свою версию, следующее сохранение — версию из ответа', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValueOnce(ok('o-1', 't1')).mockResolvedValueOnce(ok('o-1', 't2'));
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder.mock.calls[0][0]).toMatchObject({ client_rev: 4, expected_updated_at: 't0' });
    expect(useSalesStore.getState().current?.updated_at).toBe('t1');
    edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder.mock.calls[1][0]).toMatchObject({ expected_updated_at: 't1', title: 'C' });
    expect(useSalesStore.getState().current?.updated_at).toBe('t2');
  });

  it('правка во время полёта уходит с версией из ответа первого сохранения', async () => {
    await open('o-1', 't0');
    const first = deferred();
    api.saveSalesOrder.mockReturnValueOnce(first.promise).mockResolvedValue(ok('o-1', 't2'));
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    edit((o) => ({ ...o, title: 'C' }));
    first.resolve(ok('o-1', 't1'));
    await vi.runAllTimersAsync();
    expect(api.saveSalesOrder.mock.calls[1][0]).toMatchObject({ expected_updated_at: 't1', title: 'C' });
  });

  it('новый заказ уходит без версии и получает её из ответа', async () => {
    api.saveSalesOrder.mockResolvedValue(ok('new-1', 't1'));
    await useSalesStore.getState().createNew();
    expect(api.saveSalesOrder.mock.calls[0][0]).not.toHaveProperty('expected_updated_at');
    expect(api.saveSalesOrder.mock.calls[0][0].client_rev).toBe(4);
    expect(useSalesStore.getState().current).toMatchObject({ id: 'new-1', updated_at: 't1' });
  });

  it('ответ сохранения закрытого заказа не попадает в открытый следом', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(ok('o-1', 't1'));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await open('o-2', 'u0');
    expect(useSalesStore.getState().current).toMatchObject({ id: 'o-2', updated_at: 'u0' });
  });

  it('повторное открытие во время сохранения (StrictMode) — версия из ответа остаётся', async () => {
    await open('o-1', 't0');
    const save = deferred();
    api.saveSalesOrder.mockReturnValueOnce(save.promise);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    const closing = useSalesStore.getState().close();
    await useSalesStore.getState().open('o-1');
    save.resolve(ok('o-1', 't1'));
    await closing;
    expect(useSalesStore.getState().current).toMatchObject({ id: 'o-1', title: 'B', updated_at: 't1' });
  });

  it.each([
    ['outdated', OUTDATED],
    ['conflict', CONFLICT],
  ])('%s — текст сервера тостом ровно один раз, статус конечный', async (kind, message) => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail(kind, message));
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe(kind);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(message);
    edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await useSalesStore.getState().close();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('отказ «обновите страницу» в одном заказе не глушит его в следующем', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail('conflict', CONFLICT));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await open('o-2', 'u0');
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
});

describe('useSalesStore — только чтение и конечные состояния (веха 3)', () => {
  const LOCKED = 'Заказ отправлен в работу — правка закрыта';
  const OUTDATED = 'Вышло обновление — обновите страницу, правка не сохранена';
  const CONFLICT = 'Заказ изменён в другой вкладке — обновите страницу';

  it('заказ не в черновике открывается в «только чтение»', async () => {
    await open('o-1', 't0', 'quoted');
    expect(useSalesStore.getState().saveState).toBe('locked');
  });

  it('правка заказа ready_to_launch не меняет карточку и не зовёт RPC', async () => {
    await open('o-1', 't0', 'ready_to_launch');
    const before = useSalesStore.getState().current;
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    expect(useSalesStore.getState().current).toBe(before);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    await useSalesStore.getState().flush();
    await useSalesStore.getState().close();
    expect(api.saveSalesOrder).not.toHaveBeenCalled();
  });

  it('locked — ровно одно перечитывание заказа, дальше правка и сохранение молчат', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail('locked', LOCKED));
    api.fetchSalesOrder.mockResolvedValue(newSalesOrder({ id: 'o-1', title: 'Сервер', status: 'ready_to_launch', updated_at: 't9' }));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2); // открытие + одно перечитывание
    expect(useSalesStore.getState().saveState).toBe('locked');
    expect(useSalesStore.getState().current).toMatchObject({ id: 'o-1', title: 'Сервер', status: 'ready_to_launch' });
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    await useSalesStore.getState().flush();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(LOCKED);
  });

  it('outdated — плашка «Вышло обновление» и сохранения останавливаются', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail('outdated', OUTDATED));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('outdated');
    expect(useAppUpdateStore.getState().available).toBe(true);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    await useSalesStore.getState().flush();
    await useSalesStore.getState().close();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
  });

  it('правка во время полёта, кончившегося outdated, не уходит вдогонку', async () => {
    await open('o-1', 't0');
    const first = deferred();
    api.saveSalesOrder.mockReturnValueOnce(first.promise).mockResolvedValue(ok());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    first.resolve(fail('outdated', OUTDATED));
    await vi.runAllTimersAsync();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(useSalesStore.getState().saveState).toBe('outdated');
  });

  it('conflict — повторов нет, заказ перечитан один раз, правки остаются в карточке', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail('conflict', CONFLICT));
    api.fetchSalesOrder.mockResolvedValue(newSalesOrder({ id: 'o-1', title: 'Сервер', status: 'draft', updated_at: 't5' }));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(useSalesStore.getState().saveState).toBe('conflict');
    expect(useSalesStore.getState().current?.title).toBe('B');
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    await useSalesStore.getState().flush();
    await useSalesStore.getState().close();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
  });

  it('conflict, а заказ уже отправлен в работу — «только чтение» с версией сервера', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail('conflict', CONFLICT));
    api.fetchSalesOrder.mockResolvedValue(newSalesOrder({ id: 'o-1', title: 'Сервер', status: 'ready_to_launch', updated_at: 't5' }));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(useSalesStore.getState().saveState).toBe('locked');
    expect(useSalesStore.getState().current).toMatchObject({ title: 'Сервер', status: 'ready_to_launch' });
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
  });

  it('обычный сбой после конечного отказа другого заказа снова даёт тост', async () => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValueOnce(fail('conflict', CONFLICT));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await open('o-2', 'u0');
    api.saveSalesOrder.mockResolvedValue(fail());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('error');
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('open с force перечитывает тот же заказ', async () => {
    await open('o-1', 't0');
    api.fetchSalesOrder.mockResolvedValueOnce(newSalesOrder({ id: 'o-1', title: 'Z', updated_at: 't1' }));
    await useSalesStore.getState().open('o-1', { force: true });
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
    expect(useSalesStore.getState().current?.title).toBe('Z');
  });
});

describe('useSalesStore — сброс при выходе', () => {
  it('после выхода нет ни заказа, ни списка; отложенное сохранение не уходит', async () => {
    api.fetchSalesOrders.mockResolvedValue([{ id: 'o-1' }]);
    await useSalesStore.getState().loadList();
    expect(useSalesStore.getState().list).toHaveLength(1);
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(ok());
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    runAppResets();
    expect(useSalesStore.getState().current).toBeNull();
    expect(useSalesStore.getState().list).toEqual([]);
    expect(useSalesStore.getState().saveState).toBe('clean');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(api.saveSalesOrder).not.toHaveBeenCalled();
    await open('o-1', 't0');
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
  });

  it('ответ сохранения, пришедший после выхода, ничего не кладёт в стор', async () => {
    await open('o-1', 't0');
    const save = deferred();
    api.saveSalesOrder.mockReturnValueOnce(save.promise);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    runAppResets();
    save.resolve(fail());
    await vi.runAllTimersAsync();
    expect(useSalesStore.getState().current).toBeNull();
    expect(useSalesStore.getState().saveState).toBe('clean');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ответ старого полёта после выхода не обнуляет ссылку на новое сохранение — параллельного RPC нет', async () => {
    await open('o-1', 't0');
    const oldSave = deferred();
    api.saveSalesOrder.mockReturnValueOnce(oldSave.promise);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    runAppResets();

    await open('o-2', 't1');
    const saveB = deferred();
    api.saveSalesOrder.mockReturnValueOnce(saveB.promise).mockResolvedValue(ok('o-2', 't3'));
    useSalesStore.getState().edit((o) => ({ ...o, title: 'C' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);

    // Ответ запроса, ушедшего до выхода: ничей, и ссылку на полёт B не трогает
    oldSave.resolve(ok('o-1', 't2'));
    await vi.advanceTimersByTimeAsync(0);
    useSalesStore.getState().edit((o) => ({ ...o, title: 'D' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(2);

    // Правка D уходит вдогонку за B, а не рядом с ним
    saveB.resolve(ok('o-2', 't2'));
    await vi.runAllTimersAsync();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(3);
    expect(api.saveSalesOrder.mock.calls[2][0].title).toBe('D');
    expect(useSalesStore.getState().saveState).toBe('clean');
  });
});
