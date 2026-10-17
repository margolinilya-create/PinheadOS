import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { findOwnEmptyDraft } from './salesOrders';

/** Цепочка PostgREST: каждый фильтр возвращает её же, `limit` отдаёт ответ */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'is', 'order']) c[m] = vi.fn(() => c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

const from = supabase.from as unknown as ReturnType<typeof vi.fn>;
const UID = '11111111-2222-3333-4444-555555555555';

describe('findOwnEmptyDraft — свой пустой черновик для «Новый заказ»', () => {
  beforeEach(() => from.mockReset());

  it('находит черновик без клиента и без позиций; запрос сужен до своих черновиков v4', async () => {
    const c = chain({
      data: [
        { id: 'o-client', customer: 'Ромашка', status: 'draft', created_by: UID, order_items: [] },
        { id: 'o-items', customer: '', status: 'draft', created_by: UID, order_items: [{ id: 'i-1' }] },
        { id: 'o-empty', customer: '  ', status: 'draft', created_by: UID, order_items: [] },
      ],
      error: null,
    });
    from.mockReturnValue(c);
    expect(await findOwnEmptyDraft(UID)).toEqual({ ok: true, id: 'o-empty' });
    expect(from).toHaveBeenCalledWith('orders');
    expect(c.eq).toHaveBeenCalledWith('schema_version', 4);
    expect(c.eq).toHaveBeenCalledWith('status', 'draft');
    expect(c.eq).toHaveBeenCalledWith('created_by', UID);
    expect(c.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('чужой или отправленный заказ пустым черновиком не считается, даже если база его вернула', async () => {
    from.mockReturnValue(chain({
      data: [
        { id: 'o-other', customer: '', status: 'draft', created_by: 'someone', order_items: [] },
        { id: 'o-sent', customer: '', status: 'quoted', created_by: UID, order_items: [] },
      ],
      error: null,
    }));
    expect(await findOwnEmptyDraft(UID)).toEqual({ ok: true, id: null });
  });

  it('ошибка запроса — ok: false (новый заказ не создаётся)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    from.mockReturnValue(chain({ data: null, error: { message: 'boom' } }));
    expect(await findOwnEmptyDraft(UID)).toEqual({ ok: false });
  });

  it('профиль режима разработки (`dev`, не uuid) — запроса нет, черновика нет', async () => {
    expect(await findOwnEmptyDraft('dev')).toEqual({ ok: true, id: null });
    expect(from).not.toHaveBeenCalled();
  });
});
