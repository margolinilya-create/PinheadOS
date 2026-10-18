import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSalesStore, __resetSalesStoreForTests, SAVE_DEBOUNCE_MS } from './useSalesStore';
import { markServerZoneNotes } from '../api/salesOrders';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';

/**
 * Окно «фронт ревизии 4 → K» (веха 8, К5): стор узнаёт, что сервер знает
 * `zone_id` и `notes`, из ответа сохранения (ключ `notes`) или из чтения
 * заказа (`markServerZoneNotes` ставит `fetchSalesOrder`), и только тогда
 * кладёт поля в payload. Признак `serverHasNotes` показывает поле
 * «Комментарий для цехов».
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

const saved = (extra: Record<string, unknown> = {}) => ({
  ok: true, saved: { id: 'o-1', order_number: 'PH-0001', updated_at: 'v2', ...extra },
});

const order = () => newSalesOrder({
  id: 'o-1', updated_at: 'v1', notes: 'Упаковать по 10',
  items: [newSalesItem({ prints: [newSalesPrint({ zone: 'Грудь', zone_id: 'front' })] })],
});

beforeEach(() => {
  __resetSalesStoreForTests();
  vi.useFakeTimers();
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(() => { vi.useRealTimers(); });

async function editAndSave() {
  useSalesStore.getState().edit((o) => ({ ...o, title: 'Б' }));
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
}

describe('useSalesStore — сервер знает zone_id и notes', () => {
  it('сервер старше K: поля не уходят, признак ложный', async () => {
    api.fetchSalesOrder.mockResolvedValueOnce(order());
    await useSalesStore.getState().open('o-1');
    api.saveSalesOrder.mockResolvedValue(saved());
    await editAndSave();
    const body = api.saveSalesOrder.mock.calls[0][0];
    expect(body).not.toHaveProperty('notes');
    expect(body.items[0].prints[0]).not.toHaveProperty('zone_id');
    expect(useSalesStore.getState().serverHasNotes).toBe(false);
  });

  it('ответ сохранения с notes — признак истинный, следующее сохранение несёт поля', async () => {
    api.fetchSalesOrder.mockResolvedValueOnce(order());
    await useSalesStore.getState().open('o-1');
    api.saveSalesOrder.mockResolvedValue(saved({ notes: '' }));
    await editAndSave();
    expect(useSalesStore.getState().serverHasNotes).toBe(true);
    // ответ сервера не затирает комментарий в карточке
    expect(useSalesStore.getState().current?.notes).toBe('Упаковать по 10');
    await editAndSave();
    const body = api.saveSalesOrder.mock.calls[1][0];
    expect(body.notes).toBe('Упаковать по 10');
    expect(body.items[0].prints[0].zone_id).toBe('front');
  });

  it('чтение заказа после K (метку ставит fetchSalesOrder) — первое же сохранение несёт поля', async () => {
    api.fetchSalesOrder.mockImplementationOnce(async () => { markServerZoneNotes(); return order(); });
    await useSalesStore.getState().open('o-1');
    expect(useSalesStore.getState().serverHasNotes).toBe(true);
    api.saveSalesOrder.mockResolvedValue(saved({ notes: 'Упаковать по 10' }));
    await editAndSave();
    expect(api.saveSalesOrder.mock.calls[0][0].items[0].prints[0].zone_id).toBe('front');
  });

  it('выход не снимает признак: это свойство сервера, а не пользователя', async () => {
    api.fetchSalesOrder.mockResolvedValueOnce(order());
    await useSalesStore.getState().open('o-1');
    api.saveSalesOrder.mockResolvedValue(saved({ notes: '' }));
    await editAndSave();
    const { runAppResets } = await import('../../store/appReset');
    runAppResets();
    expect(useSalesStore.getState().serverHasNotes).toBe(true);
  });
});
