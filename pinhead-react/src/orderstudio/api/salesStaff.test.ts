import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { fetchSalesStaff, setSalesStaff } from './salesStaff';

/**
 * Менеджеры продаж — только RPC миграции E (20261017093841_sales_staff_flag):
 * `sales_staff_list` и `sales_set_staff`. Ошибка Supabase — `toast.error`
 * с текстом сервера и `null`/`false` (правило проекта).
 */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const ROW = {
  id: 'p-1', name: 'Анна', email: 'a@pinhead.ru', role: 'manager',
  active: true, approved: true, is_sales: false,
};

describe('salesStaff', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.restoreAllMocks();
  });

  it('fetchSalesStaff зовёт sales_staff_list и отдаёт строки', async () => {
    rpc.mockResolvedValueOnce({ data: [ROW], error: null });
    expect(await fetchSalesStaff()).toEqual([ROW]);
    expect(rpc).toHaveBeenCalledWith('sales_staff_list');
  });

  it('fetchSalesStaff: пустой ответ — пустой список', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchSalesStaff()).toEqual([]);
  });

  it('fetchSalesStaff: ошибка — toast.error с текстом сервера и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: [ROW], error: { message: 'Список менеджеров продаж видит администратор или директор' } });
    expect(await fetchSalesStaff()).toBeNull();
    expect(err).toHaveBeenCalledWith('Список менеджеров продаж видит администратор или директор');
  });

  it('setSalesStaff зовёт sales_set_staff с профилем и признаком', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await setSalesStaff('p-1', true)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('sales_set_staff', { p_profile: 'p-1', p_on: true });
  });

  it('setSalesStaff: ошибка — toast.error и false', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Отмечать менеджеров продаж может администратор или директор', code: '42501' } });
    expect(await setSalesStaff('p-1', false)).toBe(false);
    expect(err).toHaveBeenCalledWith('Отмечать менеджеров продаж может администратор или директор');
  });

  it('setSalesStaff: отказ сети — toast.error и false', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await setSalesStaff('p-1', true)).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/^Не удалось сохранить признак менеджера продаж: /);
  });
});
