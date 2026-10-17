// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { supabase } from '../../lib/supabase';
import { saveFailureKind, saveSalesOrder } from './salesOrders';

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
    expect(r).toEqual({ ok: true, saved: { id: 'o-1', order_number: 'PH-1', updated_at: 't' } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('order_v4_save_full', { p_order: payload });
  });

  it('сбой — сохранение не считается удавшимся, текст сервера не теряется', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveSalesOrder({ urgent_days: 5 })).toEqual({ ok: false, kind: 'other', message: 'x' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('отказ сети (исключение) — other, а не необработанный промис', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveSalesOrder({})).toEqual({ ok: false, kind: 'other', message: 'Failed to fetch' });
  });

  it('обёртка на сервере зовёт обе функции внутри себя — откат общий', () => {
    // Последняя редакция обёртки — она и действует на бою
    const file = readdirSync(MIGRATIONS).sort()
      .filter((f) => /create or replace function public\.order_v4_save_full\(/.test(readFileSync(join(MIGRATIONS, f), 'utf8')))
      .at(-1);
    expect(file).toBeTruthy();
    const sql = readFileSync(join(MIGRATIONS, file as string), 'utf8');
    expect(sql).toMatch(/order_v4_save\(p_order\)/);
    expect(sql).toMatch(/order_v4_set_urgent_days\(/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/revoke execute on function public\.order_v4_save_full\(jsonb\) from public, anon/);
  });
});

describe('saveSalesOrder — вид отказа по коду и тексту сервера', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    ['P0001', 'Вышло обновление — обновите страницу, правка не сохранена', 'outdated'],
    ['P0001', 'Заказ изменён в другой вкладке — обновите страницу', 'conflict'],
    ['42501', 'Заказ отправлен в работу — правка закрыта', 'locked'],
    ['42501', 'Заказ не найден или недоступен', 'other'],
    ['P0001', 'Такой переход статуса недоступен', 'other'],
  ])('%s «%s» → %s', async (code, message, kind) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
    expect(await saveSalesOrder({})).toEqual({ ok: false, kind, message });
  });

  it('код решает вместе с текстом: «Вышло обновление» под чужим кодом — other', () => {
    expect(saveFailureKind({ code: '42501', message: 'Вышло обновление' })).toBe('other');
    expect(saveFailureKind({ code: 'P0001', message: 'правка закрыта' })).toBe('other');
    expect(saveFailureKind(null)).toBe('other');
  });
});
