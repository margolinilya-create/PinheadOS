import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { fetchSalesStaff, setSalesStaff } from './salesStaff';

/**
 * Сотрудники продаж — только RPC миграций E и F (`…_sales_staff_flag`,
 * `…_sales_ms_flag`): `sales_staff_list` и `sales_set_staff(p_profile, p_kind, p_on)`.
 * Ошибка Supabase — `toast.error` с текстом сервера и `null`/`false` (правило проекта).
 */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const ROW = {
  id: 'p-1', name: 'Анна', email: 'a@pinhead.ru', role: 'manager',
  active: true, approved: true, is_sales: false, is_ms: true,
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
    rpc.mockResolvedValueOnce({ data: [ROW], error: { message: 'Список сотрудников продаж видит администратор, директор или РОП' } });
    expect(await fetchSalesStaff()).toBeNull();
    expect(err).toHaveBeenCalledWith('Список сотрудников продаж видит администратор, директор или РОП');
  });

  it('fetchSalesStaff: строка без is_ms (сервер до миграции F) — признак false', async () => {
    const { is_ms: _drop, ...old } = ROW;
    rpc.mockResolvedValueOnce({ data: [old], error: null });
    expect(await fetchSalesStaff()).toEqual([{ ...old, is_ms: false }]);
  });

  it.each([
    ['sales', true],
    ['ms', false],
  ] as const)('setSalesStaff зовёт sales_set_staff с профилем, видом %s и признаком', async (kind, on) => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await setSalesStaff('p-1', kind, on)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('sales_set_staff', { p_profile: 'p-1', p_kind: kind, p_on: on });
  });

  it('setSalesStaff: ошибка — toast.error и false', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Отмечать сотрудников продаж может администратор, директор или РОП', code: '42501' } });
    expect(await setSalesStaff('p-1', 'ms', false)).toBe(false);
    expect(err).toHaveBeenCalledWith('Отмечать сотрудников продаж может администратор, директор или РОП');
  });

  it('setSalesStaff: отказ сети — toast.error и false', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await setSalesStaff('p-1', 'sales', true)).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/^Не удалось сохранить признак сотрудника продаж: /);
  });
});
