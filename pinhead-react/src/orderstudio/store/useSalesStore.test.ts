import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSalesStore, __resetSalesStoreForTests, SAVE_DEBOUNCE_MS } from './useSalesStore';
import { newSalesOrder } from '../model/factory';

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
});
afterEach(() => { vi.useRealTimers(); });

const open = (id = 'o-1', updated_at: string | null = null) => {
  api.fetchSalesOrder.mockResolvedValueOnce(newSalesOrder({ id, title: 'A', updated_at }));
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
    expect(useSalesStore.getState().saveState).toBe('saved');
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
    expect(useSalesStore.getState().saveState).toBe('saved');
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
    expect(useSalesStore.getState().saveState).toBe('saved');
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
    expect(api.saveSalesOrder.mock.calls[0][0]).toMatchObject({ client_rev: 3, expected_updated_at: 't0' });
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
    expect(api.saveSalesOrder.mock.calls[0][0].client_rev).toBe(3);
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
  ])('%s — текст сервера тостом ровно один раз, статус «ошибка»', async (kind, message) => {
    await open('o-1', 't0');
    api.saveSalesOrder.mockResolvedValue(fail(kind, message));
    const { edit } = useSalesStore.getState();
    edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSalesStore.getState().saveState).toBe('error');
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
