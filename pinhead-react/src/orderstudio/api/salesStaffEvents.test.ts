import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { STAFF_EVENTS_LIMIT, fetchStaffEvents } from './salesStaff';

/**
 * Журнал смены признаков (миграция L, `sales_staff_events`): обычный select
 * по политике `sales_is_lead()`, последние 50, новые сверху. Ошибка — тост и null.
 */
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

function chain(result: unknown) {
  const c = {
    select: vi.fn(() => c),
    order: vi.fn(() => c),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return c;
}

describe('fetchStaffEvents', () => {
  beforeEach(() => { vi.restoreAllMocks(); from.mockReset(); });

  it('select журнала, новые сверху, предел 50', async () => {
    const ev = [{ id: 2, profile_id: 'p', kind: 'sales', on_value: true, actor: 'a', source: 'rpc', at: '2026-10-17T11:03:00Z' }];
    const c = chain({ data: ev, error: null });
    from.mockReturnValueOnce(c);
    expect(await fetchStaffEvents()).toEqual(ev);
    expect(from).toHaveBeenCalledWith('sales_staff_events');
    expect(c.order).toHaveBeenCalledWith('at', { ascending: false });
    expect(c.limit).toHaveBeenCalledWith(STAFF_EVENTS_LIMIT);
    expect(STAFF_EVENTS_LIMIT).toBe(50);
  });

  it('ошибка Supabase — toast.error и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    from.mockReturnValueOnce(chain({ data: null, error: { message: 'permission denied' } }));
    expect(await fetchStaffEvents()).toBeNull();
    expect(err).toHaveBeenCalledWith('Не удалось загрузить журнал отметок');
  });

  it('пустой ответ — пустой список', async () => {
    from.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await fetchStaffEvents()).toEqual([]);
  });
});
