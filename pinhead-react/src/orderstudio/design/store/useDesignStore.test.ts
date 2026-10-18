import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSalesStore, __resetSalesStoreForTests } from '../../store/useSalesStore';
import { runAppResets } from '../../../store/appReset';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import type { SalesOrder, SalesOrderStatus, SalesPrint } from '../../model/types';
import { COALESCE_MS, HISTORY_LIMIT, useDesignStore } from './useDesignStore';

vi.mock('../../api/salesOrders', async (orig) => ({
  ...(await orig<typeof import('../../api/salesOrders')>()),
  fetchSalesOrders: vi.fn(),
  fetchSalesOrder: vi.fn(),
  saveSalesOrder: vi.fn(() => new Promise(() => {})),
}));

const assets = vi.hoisted(() => ({ releaseArtworkImages: vi.fn(), releaseFlatImages: vi.fn() }));
vi.mock('../assets/imageLayer', () => ({ releaseArtworkImages: assets.releaseArtworkImages, releaseFlatImages: assets.releaseFlatImages }));

const ORDER = 'o-1';

function openOrder(status: SalesOrderStatus = 'draft', items = [newSalesItem({ key: 'a' }), newSalesItem({ key: 'b' })]): SalesOrder {
  const order = newSalesOrder({ id: ORDER, status, items });
  useSalesStore.setState({ current: order, saveState: status === 'draft' ? 'clean' : 'locked' });
  return order;
}

const item = (key = 'a') => useSalesStore.getState().current!.items.find((it) => it.key === key)!;
const ds = () => useDesignStore.getState();
const addPrint = (zone: string) => ds().commit('Логотип', (it) => ({ prints: [...it.prints, newSalesPrint({ zone })] }));
const setWidth = (key: string, w: number) => ds().commit('Ширина', (it) => ({
  prints: it.prints.map((p): SalesPrint => (p.key === key ? { ...p, width_mm: w } : p)),
}), `w:${key}`);

beforeEach(() => {
  __resetSalesStoreForTests();
  ds().reset();
  assets.releaseArtworkImages.mockClear();
  assets.releaseFlatImages.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('useDesignStore — привязка', () => {
  it('bind ничего не пишет в заказ (открытие вкладки — без записи)', () => {
    const order = openOrder();
    const edit = vi.spyOn(useSalesStore.getState(), 'edit');
    ds().bind(ORDER, 'a');
    expect(edit).not.toHaveBeenCalled();
    expect(useSalesStore.getState().current).toBe(order);
    expect(useSalesStore.getState().saveState).toBe('clean');
    expect(ds()).toMatchObject({ orderId: ORDER, itemKey: 'a', view: 'front', selectedPrintKey: null });
  });

  it('смена позиции — история, выбор и масштаб сброшены; вид — перед', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Грудь (перед)');
    ds().select(item().prints[0].key);
    ds().setView('back');
    ds().setZoom(2);
    ds().bind(ORDER, 'b');
    expect(ds()).toMatchObject({ itemKey: 'b', past: [], future: [], selectedPrintKey: null, view: 'front', zoom: 1 });
  });

  it('повторный bind той же позиции историю не трогает', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    ds().bind(ORDER, 'a');
    expect(ds().past).toHaveLength(1);
  });

  it('смена заказа освобождает картинки логотипов; reset — и флэтов', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    expect(assets.releaseArtworkImages).not.toHaveBeenCalled();
    ds().bind('o-2', 'a');
    expect(assets.releaseArtworkImages).toHaveBeenCalledTimes(1);
    ds().reset();
    expect(assets.releaseArtworkImages).toHaveBeenCalledTimes(2);
    expect(assets.releaseFlatImages).toHaveBeenCalledTimes(1);
  });

  it('выход (runAppResets) сбрасывает привязку и историю', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    runAppResets();
    expect(ds()).toMatchObject({ orderId: null, itemKey: null, past: [], future: [] });
  });

  it('setView снимает выбор; масштаб в разумных пределах', () => {
    ds().select('k');
    ds().setView('back');
    expect(ds()).toMatchObject({ view: 'back', selectedPrintKey: null });
    ds().setZoom(100);
    expect(ds().zoom).toBe(8);
    ds().setZoom(0);
    expect(ds().zoom).toBe(0.25);
    ds().setPan({ x: 5, y: -3 });
    expect(ds().pan).toEqual({ x: 5, y: -3 });
  });
});

describe('useDesignStore — правка и undo', () => {
  it('commit пишет нанесения и флэт через edit; undo и redo возвращают', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    expect(ds().commit('Логотип', (it) => ({ prints: [...it.prints, newSalesPrint({ zone: 'Спина' })], flat_id: 'tshirt-free' }))).toBe(true);
    expect(item()).toMatchObject({ flat_id: 'tshirt-free' });
    expect(item().prints).toHaveLength(1);
    expect(useSalesStore.getState().saveState).toBe('dirty');
    expect(ds().past.map((e) => e.label)).toEqual(['Логотип']);
    expect(ds().undo()).toBe(true);
    expect(item()).toMatchObject({ flat_id: '', prints: [] });
    expect(ds().future.map((e) => e.label)).toEqual(['Логотип']);
    expect(ds().redo()).toBe(true);
    expect(item()).toMatchObject({ flat_id: 'tshirt-free' });
    expect(item().prints).toHaveLength(1);
  });

  it('commit считает от СВЕЖИХ нанесений позиции, другие позиции не трогает', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    addPrint('Грудь (перед)');
    expect(item().prints.map((p) => p.zone)).toEqual(['Спина', 'Грудь (перед)']);
    expect(item('b').prints).toEqual([]);
  });

  it('без изменений — ни записи, ни снимка', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    expect(ds().commit('Ничего', (it) => ({ prints: it.prints }))).toBe(false);
    expect(ds().commit('Ничего', () => null)).toBe(false);
    expect(ds().past).toEqual([]);
    expect(useSalesStore.getState().saveState).toBe('clean');
  });

  it('серия правок одного ключа за 800 мс — один снимок; пауза — новый', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    const key = item().prints[0].key;
    for (let w = 100; w < 105; w++) {
      setWidth(key, w);
      vi.advanceTimersByTime(COALESCE_MS - 100);
    }
    expect(ds().past).toHaveLength(2);
    vi.advanceTimersByTime(COALESCE_MS);
    setWidth(key, 200);
    expect(ds().past).toHaveLength(3);
    ds().undo();
    expect(item().prints[0].width_mm).toBe(104);
    ds().undo();
    expect(item().prints[0].width_mm).toBeNull();
  });

  it('другая правка разрывает слияние', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    const key = item().prints[0].key;
    setWidth(key, 100);
    addPrint('Грудь (перед)');
    setWidth(key, 101);
    expect(ds().past).toHaveLength(4);
  });

  it('новая правка очищает «вернуть»', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    ds().undo();
    expect(ds().future).toHaveLength(1);
    addPrint('Грудь (перед)');
    expect(ds().future).toEqual([]);
  });

  it(`предел истории — ${HISTORY_LIMIT} снимков`, () => {
    openOrder();
    ds().bind(ORDER, 'a');
    for (let i = 0; i < HISTORY_LIMIT + 7; i++) addPrint(`z${i}`);
    expect(ds().past).toHaveLength(HISTORY_LIMIT);
    while (ds().undo());
    expect(item().prints).toHaveLength(7);
  });

  it('undo сохраняет выбор, если нанесение осталось, иначе снимает', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    const first = item().prints[0].key;
    addPrint('Грудь (перед)');
    const second = item().prints[1].key;
    ds().select(second);
    ds().undo();
    expect(ds().selectedPrintKey).toBeNull();
    ds().select(first);
    ds().redo();
    expect(ds().selectedPrintKey).toBe(first);
  });

  it('пустая история — undo/redo ничего не делают', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    expect(ds().undo()).toBe(false);
    expect(ds().redo()).toBe(false);
  });
});

describe('useDesignStore — только чтение (Review Focus 2)', () => {
  it('не черновик — commit ничего не пишет и не копит историю', () => {
    const order = openOrder('ready_to_launch');
    ds().bind(ORDER, 'a');
    expect(addPrint('Спина')).toBe(false);
    expect(ds().past).toEqual([]);
    expect(useSalesStore.getState().current).toBe(order);
  });

  it('не черновик даже при «чистом» состоянии сохранения — история не копится', () => {
    openOrder('price_review');
    useSalesStore.setState({ saveState: 'clean' });
    ds().bind(ORDER, 'a');
    expect(addPrint('Спина')).toBe(false);
    expect(ds().past).toEqual([]);
    expect(ds().canEdit()).toBe(false);
  });

  it.each(['locked', 'outdated', 'conflict'] as const)('конечное состояние сохранения «%s» — правки нет', (saveState) => {
    openOrder();
    useSalesStore.setState({ saveState });
    ds().bind(ORDER, 'a');
    expect(addPrint('Спина')).toBe(false);
    expect(ds().past).toEqual([]);
  });

  it('заказ стал не черновиком после правки — undo не пишет, история цела', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    addPrint('Спина');
    useSalesStore.setState((s) => ({ current: { ...s.current!, status: 'ready_to_launch' }, saveState: 'locked' }));
    expect(ds().undo()).toBe(false);
    expect(item().prints).toHaveLength(1);
    expect(ds().past).toHaveLength(1);
  });

  it('привязка к другому заказу или позиции нет — правка не уходит', () => {
    openOrder();
    ds().bind('o-other', 'a');
    expect(addPrint('Спина')).toBe(false);
    ds().bind(ORDER, 'missing');
    expect(addPrint('Спина')).toBe(false);
    ds().bind(null, 'a');
    expect(addPrint('Спина')).toBe(false);
    ds().reset();
    expect(addPrint('Спина')).toBe(false);
    expect(useSalesStore.getState().saveState).toBe('clean');
  });

  it('canEdit отражает черновик и состояние сохранения', () => {
    openOrder();
    ds().bind(ORDER, 'a');
    expect(ds().canEdit()).toBe(true);
    useSalesStore.setState({ saveState: 'conflict' });
    expect(ds().canEdit()).toBe(false);
  });
});
