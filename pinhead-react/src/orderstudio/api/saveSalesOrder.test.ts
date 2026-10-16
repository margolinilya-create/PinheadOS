// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { supabase } from '../../lib/supabase';
import { saveSalesOrder } from './salesOrders';

/**
 * Заказ и дни срочного пошива — ОДНИМ RPC `order_v4_save_full` (16.10).
 * Два вызова подряд не были транзакцией: сбой второго оставлял заказ
 * в базе, а клиент терял его id и при повторе создавал ещё один.
 */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

describe('saveSalesOrder — одна транзакция', () => {
  beforeEach(() => rpc.mockReset());

  it('сохраняет заказ с днями одним вызовом', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-1', order_number: 'PH-1', updated_at: 't' }, error: null });
    const payload = { id: null, urgent: true, urgent_days: 10 };
    const r = await saveSalesOrder(payload);
    expect(r?.id).toBe('o-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('order_v4_save_full', { p_order: payload });
  });

  it('сбой — сохранение не считается удавшимся', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveSalesOrder({ urgent_days: 5 })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('обёртка на сервере зовёт обе функции внутри себя — откат общий', () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith('_order_v4_save_full.sql'));
    expect(file).toBeTruthy();
    const sql = readFileSync(join(MIGRATIONS, file as string), 'utf8');
    expect(sql).toMatch(/order_v4_save\(p_order\)/);
    expect(sql).toMatch(/order_v4_set_urgent_days\(/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/revoke execute on function public\.order_v4_save_full\(jsonb\) from public, anon/);
  });
});
