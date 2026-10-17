// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mockAnswersForTest as mock, type MockExtras } from '../../../e2e/support/mockSupabase';
import { GARMENT_FLATS_FIXTURE, flatStorageObjects } from '../../../e2e/support/flatsFixture';
import { CATALOG_PUT_KEYS } from './catalogAdmin';
import { flatSvgPath, isFlatPath, type FlatViewKind } from './garmentFlats';

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

  it('sales_staff_list и sales_set_staff: трёхаргументная; двухаргументной нет (миграция H) — PGRST202', () => {
    const ex: MockExtras = { salesStaff: [{ id: 'p1', is_sales: false, is_ms: false }] };
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_on: true }, ex)).toMatchObject({ error: { code: 'PGRST202' } });
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_kind: 'sales', p_on: true }, ex)).toEqual({ data: null });
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_kind: 'ms', p_on: true }, ex)).toEqual({ data: null });
    expect(mock.rpc('sales_staff_list', {}, ex)).toEqual({ data: [{ id: 'p1', is_sales: true, is_ms: true }] });
    expect(mock.rpc('sales_set_staff', { p_profile: 'p1', p_kind: 'role', p_on: true }, ex)).toMatchObject({ error: { code: '22023' } });
  });

  it('garmentFlats: в белом списке; полный select с key=neq.garmentFlats его не отдаёт', () => {
    const ex: MockExtras = { catalogs: { app_config: { garmentFlats: { version: 1, flats: [] }, tzSettings: { footerText: 'А' } } } };
    expect(mock.table('app_config', 'select=key,value&key=neq.garmentFlats', ex)).toEqual([{ key: 'tzSettings', value: { footerText: 'А' } }]);
    expect(mock.table('app_config', 'select=key,value&key=eq.garmentFlats', ex)).toHaveLength(1);
    expect(mock.rpc('catalog_put', { p_table: 'app_config', p_key: 'garmentFlats', p_value: { version: 1, flats: [] }, p_base: { version: 1, flats: [] } }, ex))
      .toHaveProperty('data');
  });
});

describe('мок e2e: объекты Storage с телом (веха 5а)', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

  it('без карты объектов чтение — 404, как раньше', () => {
    expect(mock.storageRead('GET', 'garment-flats/flats/tee/v1/front.svg', {})).toEqual({ status: 404 });
  });

  it('чтение по пути download, authenticated и sign отдаёт тело и тип', () => {
    const ex: MockExtras = { storageObjects: { 'garment-flats/flats/tee/v1/front.svg': { type: 'image/svg+xml', body: Buffer.from(SVG) } } };
    for (const key of ['garment-flats/flats/tee/v1/front.svg', 'authenticated/garment-flats/flats/tee/v1/front.svg', 'sign/garment-flats/flats/tee/v1/front.svg']) {
      const r = mock.storageRead('GET', key, ex);
      expect(r, key).toMatchObject({ status: 200, type: 'image/svg+xml' });
      expect(String((r as { body: Buffer }).body), key).toBe(SVG);
    }
    expect(mock.storageRead('GET', 'garment-flats/flats/tee/v1/back.svg', ex)).toEqual({ status: 404 });
  });

  it('загрузка multipart кладёт файл в карту; повтор без upsert — 409 Duplicate', () => {
    const ex: MockExtras = { storageObjects: {} };
    const boundary = '----x';
    const form = Buffer.from([
      `--${boundary}`, 'Content-Disposition: form-data; name="cacheControl"', '', '3600',
      `--${boundary}`, 'Content-Disposition: form-data; name=""; filename="blob"', 'Content-Type: image/svg+xml', '', SVG,
      `--${boundary}--`, '',
    ].join('\r\n'));
    const first = mock.storageWrite('garment-flats/flats/tee/v1/front.svg', `multipart/form-data; boundary=${boundary}`, form, 'false', ex);
    expect(first).toEqual({ status: 200 });
    expect(ex.storageObjects!['garment-flats/flats/tee/v1/front.svg'].type).toBe('image/svg+xml');
    expect(String(ex.storageObjects!['garment-flats/flats/tee/v1/front.svg'].body)).toBe(SVG);
    expect(mock.storageWrite('garment-flats/flats/tee/v1/front.svg', 'image/svg+xml', Buffer.from(SVG), 'false', ex))
      .toMatchObject({ status: 400, body: { statusCode: '409', error: 'Duplicate' } });
  });

  it('загрузка без карты — прежний успех без хранения', () => {
    expect(mock.storageWrite('order-artworks/orders/x/logo/a.png', 'image/png', Buffer.from('x'), 'false', {})).toEqual({ status: 200 });
  });
});

describe('фикстура флэтов e2e', () => {
  it('svg_path каждого вида = flatSvgPath, объект с телом SVG лежит в карте', () => {
    const objects = flatStorageObjects();
    for (const f of GARMENT_FLATS_FIXTURE.flats) {
      for (const v of f.views) {
        expect(v.svg_path).toBe(flatSvgPath(f.id, f.version, v.kind as FlatViewKind));
        expect(isFlatPath(v.svg_path)).toBe(true);
        const o = objects[`garment-flats/${v.svg_path}`];
        expect(o?.type).toBe('image/svg+xml');
        expect(String(o?.body)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        expect(String(o?.body)).not.toMatch(/<script|\son\w+=|href=/i);
      }
    }
  });
});
