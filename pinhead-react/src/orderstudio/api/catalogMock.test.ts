// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mockAnswersForTest as mock, type MockExtras } from '../../../e2e/support/mockSupabase';
import { CATALOG_PUT_KEYS } from './catalogAdmin';

/**
 * Мок e2e повторяет сервер справочников (миграция G): чтение по ключу из
 * состояния, запись только при совпадении базы, иначе P0001. Без этого e2e
 * вкладок «Справочники заказа» (задача 6) проверял бы путь, которого на бою нет:
 * вторая вкладка «сохраняла» бы поверх первой.
 */
describe('мок e2e: справочники с состоянием', () => {
  const fresh = (): MockExtras => ({
    catalogs: { app_config: { tzSettings: { footerText: 'А' }, prices: { label: 30 } }, catalog_config: {} },
  });

  it('чтение по ключу и полный select', () => {
    const ex = fresh();
    expect(mock.table('app_config', 'select=key,value&key=eq.tzSettings', ex)).toEqual([{ key: 'tzSettings', value: { footerText: 'А' } }]);
    expect(mock.table('app_config', 'select=key,value', ex)).toHaveLength(2);
    expect(mock.table('catalog_config', 'select=key,value&key=eq.suppliers', ex)).toEqual([]);
  });

  it('без фикстуры — прежнее поведение: полный select пуст, sku_catalog по ключу — два кода', () => {
    const ex: MockExtras = {};
    expect(mock.table('app_config', 'select=key,value', ex)).toEqual([]);
    expect(mock.table('app_config', 'select=value&key=eq.sku_catalog', ex)).toHaveLength(1);
  });

  it('catalog_put: база совпала (порядок ключей не важен) — записано; вторая запись со старой базой — P0001', () => {
    const ex = fresh();
    const first = mock.rpc('catalog_put', { p_table: 'app_config', p_key: 'tzSettings', p_value: { footerText: 'Б' }, p_base: { footerText: 'А' } }, ex);
    expect(first).toHaveProperty('data');
    expect(mock.table('app_config', 'key=eq.tzSettings', ex)).toEqual([{ key: 'tzSettings', value: { footerText: 'Б' } }]);
    const second = mock.rpc('catalog_put', { p_table: 'app_config', p_key: 'tzSettings', p_value: { footerText: 'В' }, p_base: { footerText: 'А' } }, ex);
    expect(second).toEqual({ error: { code: 'P0001', message: 'Справочник изменён — загрузите свежую версию' } });
  });

  it('catalog_put: строки нет — база null вставляет; ключ вне белого списка — 22023', () => {
    const ex = fresh();
    expect(mock.rpc('catalog_put', { p_table: 'catalog_config', p_key: 'suppliers', p_value: [], p_base: null }, ex)).toHaveProperty('data');
    expect(mock.rpc('catalog_put', { p_table: 'catalog_config', p_key: 'suppliers', p_value: [], p_base: null }, ex))
      .toMatchObject({ error: { code: 'P0001' } });
    expect(mock.rpc('catalog_put', { p_table: 'app_config', p_key: 'prices', p_value: {}, p_base: null }, ex))
      .toMatchObject({ error: { code: '22023' } });
  });

  it('белый список мока = клиент', () => {
    const ex: MockExtras = {};
    for (const [table, keys] of Object.entries(CATALOG_PUT_KEYS)) {
      for (const key of keys) {
        expect(mock.rpc('catalog_put', { p_table: table, p_key: key, p_value: [1], p_base: null }, ex), `${table}.${key}`)
          .toHaveProperty('data');
      }
    }
  });

  it('prices_patch: сверка по ключу, новые ключи правил цены', () => {
    const ex = fresh();
    expect(mock.rpc('prices_patch', { p_patch: { minMarginPct: 10 }, p_base: { minMarginPct: null } }, ex)).toHaveProperty('data');
    expect(mock.rpc('prices_patch', { p_patch: { label: 31 }, p_base: { label: 29 } }, ex)).toMatchObject({ error: { code: 'P0001' } });
    expect(mock.table('app_config', 'key=eq.prices', ex)).toEqual([{ key: 'prices', value: { label: 30, minMarginPct: 10 } }]);
  });

  it('отказ на запись из фикстуры', () => {
    const ex: MockExtras = { ...fresh(), catalogPutFailure: { code: '42501', message: 'нет права' } };
    expect(mock.rpc('catalog_put', { p_table: 'app_config', p_key: 'tzSettings', p_value: {}, p_base: null }, ex))
      .toEqual({ error: { code: '42501', message: 'нет права' } });
  });

  it('sales_staff_list и sales_set_staff (обе сигнатуры)', () => {
    const ex: MockExtras = { salesStaff: [{ id: 'p1', is_sales: false, is_ms: false }] };
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_on: true }, ex)).toEqual({ data: null });
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_kind: 'ms', p_on: true }, ex)).toEqual({ data: null });
    expect(mock.rpc('sales_staff_list', {}, ex)).toEqual({ data: [{ id: 'p1', is_sales: true, is_ms: true }] });
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_kind: 'role', p_on: true }, ex)).toMatchObject({ error: { code: '22023' } });
  });
});
