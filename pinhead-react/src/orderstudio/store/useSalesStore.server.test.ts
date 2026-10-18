import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSalesStore, __resetSalesStoreForTests, SAVE_DEBOUNCE_MS } from './useSalesStore';
import { newSalesOrder } from '../model/factory';
import type { SalesOrderStatus } from '../model/types';

/**
 * Ответы RPC переходов и оплаты в сторе (веха 6+7, К19): `applyServer`
 * кладёт статус и новую версию строки в открытый заказ — следующее
 * сохранение шлёт её как `expected_updated_at`, и ложного «изменён в другой
 * вкладке» нет. Флаг отправки (`beginSend`/`endSend`) закрывает правку на всё
 * время «Отправить в работу».
 */
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

const ok = (id = 'o-1', updated_at = 'now') => ({ ok: true, saved: { id, order_number: 'PH-0001', updated_at } });

beforeEach(() => {
  __resetSalesStoreForTests();
  vi.useFakeTimers();
  Object.values(api).forEach((f) => f.mockReset());
  toast.error.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

const open = (id = 'o-1', updated_at: string | null = 'v1', status: SalesOrderStatus = 'draft') => {
  api.fetchSalesOrder.mockResolvedValueOnce(newSalesOrder({ id, title: 'A', updated_at, status }));
  return useSalesStore.getState().open(id);
};

const st = () => useSalesStore.getState();

describe('applyServer — ответ RPC в открытом заказе', () => {
  it('после оплаты в черновике следующее сохранение шлёт новую версию', async () => {
    await open();
    st().applyServer({ id: 'o-1', updated_at: 'v2', status: 'draft', paid_kind: 'prepaid', paid_at: 't' });
    expect(st().current?.paid_kind).toBe('prepaid');
    api.saveSalesOrder.mockResolvedValue(ok('o-1', 'v3'));
    st().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder.mock.calls[0][0].expected_updated_at).toBe('v2');
  });

  it('чужой id — ничего не меняет', async () => {
    await open();
    st().applyServer({ id: 'o-2', updated_at: 'v9', status: 'production' });
    expect(st().current?.updated_at).toBe('v1');
    expect(st().current?.status).toBe('draft');
    expect(st().saveState).toBe('clean');
  });

  it('ready_to_launch — «только чтение», отложенное сохранение не уходит', async () => {
    await open();
    st().edit((o) => ({ ...o, title: 'B' }));
    st().applyServer({ id: 'o-1', updated_at: 'v2', status: 'ready_to_launch', sent_at: 's' });
    expect(st().saveState).toBe('locked');
    expect(st().current?.sent_at).toBe('s');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(api.saveSalesOrder).not.toHaveBeenCalled();
  });

  it('возврат в черновик после locked — снова clean, правка сохраняется с новой версией', async () => {
    await open('o-1', 'v1', 'ready_to_launch');
    expect(st().saveState).toBe('locked');
    st().applyServer({ id: 'o-1', updated_at: 'v5', status: 'draft' });
    expect(st().saveState).toBe('clean');
    api.saveSalesOrder.mockResolvedValue(ok('o-1', 'v6'));
    st().edit((o) => ({ ...o, title: 'B' }));
    expect(st().current?.title).toBe('B');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(api.saveSalesOrder.mock.calls[0][0].expected_updated_at).toBe('v5');
  });

  it('outdated и conflict ответ RPC не снимает', async () => {
    await open();
    useSalesStore.setState({ saveState: 'conflict' });
    st().applyServer({ id: 'o-1', updated_at: 'v2', status: 'draft' });
    expect(st().saveState).toBe('conflict');
    useSalesStore.setState({ saveState: 'outdated' });
    st().applyServer({ id: 'o-1', updated_at: 'v3', status: 'draft' });
    expect(st().saveState).toBe('outdated');
  });

  it('ответ без updated_at (сервер старше J) — полей не кладёт, заказ перечитывается', async () => {
    await open();
    api.fetchSalesOrder.mockResolvedValueOnce(newSalesOrder({ id: 'o-1', title: 'A', updated_at: 'v7', status: 'draft', paid_kind: 'full' }));
    st().applyServer({ id: 'o-1', status: 'draft', paid_kind: 'prepaid' });
    expect(st().current?.paid_kind).not.toBe('prepaid');
    await vi.runAllTimersAsync();
    expect(api.fetchSalesOrder).toHaveBeenCalledTimes(2);
    expect(st().current?.paid_kind).toBe('full');
    api.saveSalesOrder.mockResolvedValue(ok('o-1', 'v8'));
    st().edit((o) => ({ ...o, title: 'B' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.saveSalesOrder.mock.calls[0][0].expected_updated_at).toBe('v7');
  });
});

describe('отправка в работу — правка закрыта флагом sending', () => {
  it('beginSend: edit — no-op; endSend — правка снова работает', async () => {
    await open();
    const token = st().beginSend('o-1');
    expect(token).not.toBeNull();
    expect(st().sending).toBe(true);
    st().edit((o) => ({ ...o, title: 'B' }));
    expect(st().current?.title).toBe('A');
    st().endSend();
    expect(st().sending).toBe(false);
    st().edit((o) => ({ ...o, title: 'C' }));
    expect(st().current?.title).toBe('C');
  });

  it('editDuringSend пишет только со своим знаком и уходит flush', async () => {
    await open();
    const token = st().beginSend('o-1')!;
    expect(st().editDuringSend(token + 1, (o) => ({ ...o, title: 'X' }))).toBe(false);
    expect(st().current?.title).toBe('A');
    api.saveSalesOrder.mockResolvedValue(ok('o-1', 'v2'));
    expect(st().editDuringSend(token, (o) => ({ ...o, title: 'PDF' }))).toBe(true);
    await st().flush();
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    expect(api.saveSalesOrder.mock.calls[0][0].title).toBe('PDF');
    st().endSend();
    expect(st().editDuringSend(token, (o) => ({ ...o, title: 'Y' }))).toBe(false);
  });

  it('beginSend чужого заказа — null; открытие другого заказа снимает флаг', async () => {
    await open();
    expect(st().beginSend('o-2')).toBeNull();
    st().beginSend('o-1');
    await open('o-2');
    expect(st().sending).toBe(false);
  });
});
