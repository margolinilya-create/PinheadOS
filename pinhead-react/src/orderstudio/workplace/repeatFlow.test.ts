import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixture } from '../fixtures/loadFixture.testutil';
import type { SalesOrder } from '../model/types';
import { repointPath } from '../model/repeatOrder';

const NEW_ID = 'a1b2c3d4-0000-4000-8000-00000000e8e8';
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Анна' };

const h = vi.hoisted(() => {
  const log: string[] = [];
  const state: { current: unknown; saveState: string } = { current: null, saveState: 'clean' };
  return {
    log,
    state,
    confirm: vi.fn(),
    copyArtwork: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    store: {
      flush: vi.fn(async () => { log.push('flush'); }),
      createNew: vi.fn(),
      edit: vi.fn(),
    },
  };
});
vi.mock('../store/useSalesStore', () => ({
  useSalesStore: { getState: () => ({ ...h.store, current: h.state.current, saveState: h.state.saveState }) },
}));
vi.mock('../../store/useConfirmStore', () => ({ confirm: h.confirm }));
vi.mock('../../store/useToastStore', () => ({ toast: h.toast }));
vi.mock('../api/artworkCopy', () => ({ copyArtwork: h.copyArtwork }));

const { repeatOrder, MSG_SAVE_FIRST } = await import('./repeatFlow');

function source(): SalesOrder {
  const { order } = loadFixture('67108');
  return { ...order, number: 'PH-6710', status: 'done' };
}

describe('repeatOrder — поток «Повторить заказ» (Э8)', () => {
  let src: SalesOrder;
  let opened: SalesOrder | null;

  beforeEach(() => {
    vi.clearAllMocks();
    h.log.length = 0;
    src = source();
    h.state.current = src;
    h.state.saveState = 'locked';
    opened = null;
    h.confirm.mockImplementation(async () => { h.log.push('confirm'); return true; });
    h.store.createNew.mockImplementation(async (seed: Partial<SalesOrder>) => {
      h.log.push('createNew');
      opened = { ...src, ...seed, id: NEW_ID, status: 'draft', number: 'PH-9001' } as SalesOrder;
      h.state.current = opened;
      h.state.saveState = 'clean';
      return NEW_ID;
    });
    h.store.edit.mockImplementation((fn: (o: SalesOrder) => SalesOrder) => {
      h.log.push('edit');
      opened = fn(h.state.current as SalesOrder);
      h.state.current = opened;
    });
    h.copyArtwork.mockImplementation(async (p: string, to: string) => { h.log.push('copy'); return repointPath(p, to); });
  });

  it('порядок: flush → подтверждение → createNew (тело без файлов) → переход → копии → привязка → flush', async () => {
    const go = vi.fn(() => h.log.push('go'));
    expect(await repeatOrder(USER, go)).toBe(NEW_ID);
    const seed = h.store.createNew.mock.calls[0][0] as Partial<SalesOrder>;
    expect(seed).toMatchObject({ parent_id: src.id, manager: 'Анна', created_by: USER.id, customer: src.customer });
    expect(seed.items![0].prints.every((p) => p.artwork_path === '')).toBe(true);
    expect(go).toHaveBeenCalledWith(NEW_ID);
    const order = h.log.join(' ').replace(/(copy ?)+/, 'copy… ');
    expect(order.trim()).toBe('flush confirm createNew go copy… edit flush');
    expect(opened!.items[0].prints[0].artwork_path).toBe(`orders/${NEW_ID}/logo/a0000001-front.png`);
    expect(h.toast.success).toHaveBeenCalledWith('Создан черновик — повтор PH-6710');
    expect(h.toast.warning).not.toHaveBeenCalled();
  });

  it.each(['dirty', 'error', 'conflict', 'outdated'])('после flush состояние %s — отказ словами, ничего не создано', async (state) => {
    h.state.saveState = state;
    expect(await repeatOrder(USER, vi.fn())).toBeNull();
    expect(h.toast.error).toHaveBeenCalledWith(MSG_SAVE_FIRST);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.store.createNew).not.toHaveBeenCalled();
  });

  it('отказ в подтверждении и createNew → null — копий нет', async () => {
    h.confirm.mockResolvedValueOnce(false);
    expect(await repeatOrder(USER, vi.fn())).toBeNull();
    h.store.createNew.mockResolvedValueOnce(null);
    expect(await repeatOrder(USER, vi.fn())).toBeNull();
    expect(h.copyArtwork).not.toHaveBeenCalled();
  });

  it('часть копий не прошла — предупреждение с числом, остальные привязаны', async () => {
    const lost = src.items[0].prints[2].artwork_path;
    h.copyArtwork.mockImplementation(async (p: string, to: string) => (p === lost ? null : repointPath(p, to)));
    await repeatOrder(USER, vi.fn());
    expect(h.toast.warning).toHaveBeenCalledWith('1 файл не скопировался — загрузите заново');
    expect(opened!.items[0].prints[2]).toMatchObject({ artwork_path: '', layout: null });
    expect(opened!.items[0].prints[0].artwork_path).not.toBe('');
  });

  it('превью PDF/AI не скопировалось — исходник считается не скопированным', async () => {
    const p0 = src.items[0].prints[0];
    src.items[0].prints[0] = { ...p0, layout: { ...(p0.layout as object), asset: { ...(p0.layout as { asset: object }).asset, has_preview: true } } };
    h.copyArtwork.mockImplementation(async (p: string, to: string) => (p.endsWith('.preview.png') ? null : repointPath(p, to)));
    await repeatOrder(USER, vi.fn());
    expect(h.copyArtwork).toHaveBeenCalledWith(`${p0.artwork_path}.preview.png`, NEW_ID);
    expect(opened!.items[0].prints[0]).toMatchObject({ artwork_path: '', layout: null });
    expect(h.toast.warning).toHaveBeenCalled();
  });

  it('пока шли копии, открыли другой заказ — привязки нет (правка не уходит в чужой заказ)', async () => {
    const other = { ...src, id: 'b0000000-0000-4000-8000-000000000001' };
    h.copyArtwork.mockImplementation(async (p: string, to: string) => { h.state.current = other; return repointPath(p, to); });
    expect(await repeatOrder(USER, vi.fn())).toBe(NEW_ID);
    expect(h.store.edit).not.toHaveBeenCalled();
    expect(h.toast.warning.mock.calls[0][0]).toMatch(/создан без файлов/);
  });

  it('двойной вызов — один новый заказ', async () => {
    const a = repeatOrder(USER, vi.fn());
    const b = repeatOrder(USER, vi.fn());
    expect(await a).toBe(await b);
    expect(h.store.createNew).toHaveBeenCalledTimes(1);
  });
});
