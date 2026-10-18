// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, readSource, sourceFiles } from '../testutil/sourceFiles';

/**
 * Старые заказы (v3) — только чтение (веха 8, К6). Миграция L закрывает запись
 * v3 стражами (`42501`), клиент не пишет `orders` прямыми запросами вовсе:
 * заказ v4 пишут RPC (`order_v4_save_full`, переходы, оплата), а прямая запись
 * таблицы из кода была только у v3 (`useOrdersStore`: insert/update/delete/duplicate —
 * убраны). Сторож: ни один модуль `src` не вызывает insert/update/upsert/delete
 * у `from('orders')`.
 *
 * Перевод отказа стража L для человека в `translateSupabaseError` не заводится:
 * L применяется ДО выкладки фронта, и получить отказ может только старая вкладка
 * со своим кодом (его перевод ей не помочь), а новый фронт v3 не пишет — строка
 * легла бы во вход (+114 Б gzip) без единого читателя.
 */
const WRITE_ORDERS = /from\(\s*['"]orders['"]\s*\)\s*\.(insert|update|upsert|delete)\(/;

describe('старые заказы: клиент не пишет orders прямыми запросами', () => {
  it('нет from(\'orders\').insert/update/upsert/delete в коде приложения', () => {
    const guilty = sourceFiles()
      .filter((f) => WRITE_ORDERS.test(readSource(f).replace(/\s+/g, ' ')))
      .map((f) => relative(SRC_DIR, f));
    expect(guilty).toEqual([]);
  });

  it('самопроверка: образцы ловятся, чтение — нет', () => {
    const norm = (s: string) => s.replace(/\s+/g, ' ');
    expect(WRITE_ORDERS.test(norm("supabase.from('orders').update({ status })"))).toBe(true);
    expect(WRITE_ORDERS.test(norm('supabase.from("orders")\n  .delete().eq("id", id)'))).toBe(true);
    expect(WRITE_ORDERS.test(norm("supabase.from('orders').insert(row).select()"))).toBe(true);
    expect(WRITE_ORDERS.test(norm("supabase.from('orders').select('*')"))).toBe(false);
  });
});
