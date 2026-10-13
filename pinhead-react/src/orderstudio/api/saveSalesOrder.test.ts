import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { saveSalesOrder } from './salesOrders';

/** Дни срочного пошива уходят отдельным RPC после order_v4_save (правка 13.10) */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('saveSalesOrder — дни срочности', () => {
  beforeEach(() => rpc.mockReset());

  it('после сохранения пишет дни тем же id', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-1', order_number: 'PH-1', updated_at: 't' }, error: null })
      .mockResolvedValueOnce({ data: 10, error: null });
    const r = await saveSalesOrder({ id: null, urgent: true, urgent_days: 10 });
    expect(r?.id).toBe('o-1');
    expect(rpc.mock.calls[0][0]).toBe('order_v4_save');
    expect(rpc.mock.calls[1]).toEqual(['order_v4_set_urgent_days', { p_order_id: 'o-1', p_days: 10 }]);
  });

  it('ошибка записи дней — сохранение не считается удавшимся', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-1', order_number: 'PH-1', updated_at: 't' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveSalesOrder({ urgent_days: 5 })).toBeNull();
  });

  it('сбой order_v4_save — дни не пишутся', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveSalesOrder({ urgent_days: 5 })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
