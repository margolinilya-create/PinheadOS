import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOwnEmptyDraft = vi.fn();
const createNew = vi.fn();

vi.mock('../api/salesOrders', () => ({ findOwnEmptyDraft: (uid: string) => findOwnEmptyDraft(uid) }));
vi.mock('../store/useSalesStore', () => ({
  useSalesStore: { getState: () => ({ createNew }) },
}));

const { startNewOrder } = await import('./newOrder');

describe('startNewOrder', () => {
  beforeEach(() => {
    findOwnEmptyDraft.mockReset();
    createNew.mockReset();
    createNew.mockResolvedValue('new-id');
  });

  it('новый заказ сразу знает автора — как сервер (`created_by = auth.uid()`), без F5 (обход, W1)', async () => {
    findOwnEmptyDraft.mockResolvedValue({ ok: true, id: null });
    await expect(startNewOrder('u-seller', 'Анна')).resolves.toBe('new-id');
    expect(createNew).toHaveBeenCalledWith({ manager: 'Анна', created_by: 'u-seller' });
  });

  it('без имени менеджера автор всё равно записан', async () => {
    findOwnEmptyDraft.mockResolvedValue({ ok: true, id: null });
    await startNewOrder('u-seller');
    expect(createNew).toHaveBeenCalledWith({ created_by: 'u-seller' });
  });

  it('свой пустой черновик открывается вместо нового', async () => {
    findOwnEmptyDraft.mockResolvedValue({ ok: true, id: 'old-id' });
    await expect(startNewOrder('u-seller', 'Анна')).resolves.toBe('old-id');
    expect(createNew).not.toHaveBeenCalled();
  });

  it('упал поиск черновика — заказ не создаётся', async () => {
    findOwnEmptyDraft.mockResolvedValue({ ok: false });
    await expect(startNewOrder('u-seller', 'Анна')).resolves.toBeNull();
    expect(createNew).not.toHaveBeenCalled();
  });
});
