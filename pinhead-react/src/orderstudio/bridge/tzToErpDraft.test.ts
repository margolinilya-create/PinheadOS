// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tzToErpDraft, ITEM_FIELD_SOURCES, FORM_FIELD_SOURCES, PRINT_FIELD_SOURCES, LABEL_FIELD_SOURCES,
} from './tzToErpDraft';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesItem } from '../model/types';

/**
 * СТОРОЖ КОНТРАКТА МОСТА. Поля формы ERP читаются из САМОГО ИСХОДНИКА
 * `erp/utils/orderForm.ts` — не из списка здесь: новое поле ERP, у которого
 * нет решения «откуда берётся / почему не из Order», роняет тест.
 * Тип `Record<keyof DraftItem, …>` ловит то же на typecheck; тест —
 * вторая сторона, если typecheck в CI однажды отключат.
 */
const ORDER_FORM = readFileSync(join(__dirname, '../../erp/utils/orderForm.ts'), 'utf8');

function interfaceFields(name: string): string[] {
  const m = ORDER_FORM.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`интерфейс ${name} не найден в orderForm.ts`);
  return [...m[1].matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1]).sort();
}

describe('контракт моста: у каждого поля формы ERP есть источник', () => {
  const cases = [
    ['DraftItem', ITEM_FIELD_SOURCES],
    ['DraftForm', FORM_FIELD_SOURCES],
    ['DraftPrint', PRINT_FIELD_SOURCES],
    ['DraftLabel', LABEL_FIELD_SOURCES],
  ] as const;
  for (const [name, sources] of cases) {
    it(name, () => {
      const fields = interfaceFields(name);
      expect(fields.length).toBeGreaterThan(3);
      expect(Object.keys(sources).sort()).toEqual(fields);
    });
  }

  it('у каждого «не из Order» записана причина', () => {
    const all = [ITEM_FIELD_SOURCES, FORM_FIELD_SOURCES, PRINT_FIELD_SOURCES, LABEL_FIELD_SOURCES]
      .flatMap((s) => Object.values(s));
    for (const src of all) {
      if (src.from === 'not_from_order') expect(src.reason.length).toBeGreaterThan(10);
    }
  });
});

// ── Маппинг ────────────────────────────────────────────────────────────────

const grid = (rows: Record<string, Record<string, number>>) => ({
  sizes: [...new Set(Object.values(rows).flatMap((r) => Object.keys(r)))],
  rows: Object.entries(rows).map(([color, sizes]) => ({ color, sizes })),
});

const sku = (patch: Partial<SalesItem> = {}) => newSalesItem({
  kind: 'sku', sku_code: 'T-003', product_type: 'Футболка', fit: 'regular',
  main_fabric: 'Кулирка 180', color_supplier: 'Чёрный / Медас',
  size_grid: grid({ 'Чёрный': { S: 10, M: 20 } }),
  ...patch,
});

const order = (items: SalesItem[], patch = {}) => newSalesOrder({
  id: '11111111-1111-4111-8111-111111111111', number: 'PH-1042',
  bitrix_id: '[12345]', title: 'Дзен · футболки', customer: 'Дзен', manager: 'Илья',
  due_date: '2026-10-20', items, ...patch,
});

describe('tzToErpDraft — шапка и связь', () => {
  it('шапка переносится, дата запуска — умолчание ERP', () => {
    const d = tzToErpDraft(order([sku()]), '2026-10-01');
    expect(d.form).toMatchObject({
      bitrix_id: '[12345]', title: 'Дзен · футболки', customer: 'Дзен',
      manager: 'Илья', due_date: '2026-10-20', launch_date: '2026-10-01',
    });
  });

  it('связь tz_order_id / tz_number — для erp_create_order', () => {
    expect(tzToErpDraft(order([sku()])).link)
      .toEqual({ tz_order_id: '11111111-1111-4111-8111-111111111111', tz_number: 'PH-1042' });
    expect(tzToErpDraft(newSalesOrder()).link).toEqual({ tz_order_id: null, tz_number: null });
  });
});

describe('tzToErpDraft — позиции', () => {
  it('пошив по SKU: sewing, закупка нужна, поля ТЗ как есть', () => {
    const d = tzToErpDraft(order([sku()]));
    expect(d.items[0]).toMatchObject({
      production_type: 'sewing', product_type: 'Футболка', fit: 'regular',
      main_fabric: 'Кулирка 180', color_supplier: 'Чёрный / Медас', qty: 30,
    });
    expect(d.form.purchase_required).toBe(true);
  });

  it('два цвета одной модели — одна позиция, несколько строк сетки', () => {
    const d = tzToErpDraft(order([sku({ size_grid: grid({ 'Чёрный': { S: 10 }, 'Белый': { S: 5, M: 5 } }) })]));
    expect(d.items).toHaveLength(1);
    expect(d.items[0].size_grid?.rows).toHaveLength(2);
    expect(d.items[0].variant).toBe('Чёрный, Белый');
    expect(d.items[0].qty).toBe(20);
  });

  it('бланк со склада, сторонний бланк, давальческое — готовое изделие с источником', () => {
    const d = tzToErpDraft(order([
      sku({ kind: 'blank', blank_source: 'stock' }),
      sku({ kind: 'blank', blank_source: 'third_party' }),
      sku({ kind: 'customer' }),
    ]));
    expect(d.items.map((i) => [i.production_type, i.garment_source])).toEqual([
      ['ready_garment', 'stock'], ['ready_garment', 'purchased'], ['ready_garment', 'customer'],
    ]);
  });

  it('только давальческое и склад — закупка не нужна', () => {
    const d = tzToErpDraft(order([sku({ kind: 'customer' }), sku({ kind: 'blank', blank_source: 'stock' })]));
    expect(d.form.purchase_required).toBe(false);
  });

  it('заказ-образец — позиции уходят образцами', () => {
    const d = tzToErpDraft(order([sku()], { kind: 'sample' }));
    expect(d.items[0].production_type).toBe('samples');
  });

  it('без нанесений — has_branding false, нанесений нет', () => {
    const d = tzToErpDraft(order([sku()]));
    expect(d.items[0]).toMatchObject({ has_branding: false, prints: [] });
  });

  it('пустая сетка — предупреждение, не падение', () => {
    const d = tzToErpDraft(order([sku({ size_grid: { sizes: [], rows: [] } })]));
    expect(d.items[0].qty).toBe('');
    expect(d.warnings).toContainEqual({ kind: 'empty_grid', item: d.items[0].key });
  });
});

describe('tzToErpDraft — нанесения и бирки', () => {
  it('шелкография: мм, pantone строкой, эффект; группа размеров — в комментарий', () => {
    const p = newSalesPrint({
      method: 'silkscreen', zone: 'Грудь', width_mm: 200, height_mm: 150,
      pantone: ['186 C', 'Black C'], special: 'puff', garment_kind: 'x', sizes: ['S'], comment: 'по центру',
    });
    const [dp] = tzToErpDraft(order([sku({ prints: [p] })])).items[0].prints;
    expect(dp).toEqual({
      key: p.key, method: 'silkscreen', zone: 'Грудь', width_mm: 200, height_mm: 150,
      offset_note: '', pantone: '186 C, Black C', special: 'puff', garment_kind: '',
      comment: 'Размеры: S. по центру',
    });
  });

  it('вышивка хранит тип изделия, но не эффект', () => {
    const p = newSalesPrint({ method: 'embroidery', special: 'puff', garment_kind: 'patch' });
    const [dp] = tzToErpDraft(order([sku({ prints: [p] })])).items[0].prints;
    expect(dp).toMatchObject({ method: 'embroidery', special: '', garment_kind: 'patch' });
  });

  it('сублимация — «прочее» с названием техники и предупреждением', () => {
    const p = newSalesPrint({ method: 'sublimation' });
    const d = tzToErpDraft(order([sku({ prints: [p] })]));
    expect(d.items[0].prints[0]).toMatchObject({ method: 'other', comment: 'Сублимация' });
    expect(d.warnings).toContainEqual({ kind: 'method_as_other', item: d.items[0].key, method: 'sublimation' });
  });

  it('DTG — метод сохраняется, этапа ERP не строит: предупреждение', () => {
    const d = tzToErpDraft(order([sku({ prints: [newSalesPrint({ method: 'dtg' })] })]));
    expect(d.items[0].prints[0].method).toBe('dtg');
    expect(d.warnings).toContainEqual({ kind: 'dtg_no_stage', item: d.items[0].key });
  });

  it('на крое / на готовом: единое — переносится, разное — cut и предупреждение', () => {
    const one = tzToErpDraft(order([sku({ prints: [newSalesPrint({ on: 'finished' })] })]));
    expect(one.items[0].branding_on).toBe('finished');
    const mixed = tzToErpDraft(order([sku({ prints: [newSalesPrint({ on: 'finished' }), newSalesPrint({ on: 'cut' })] })]));
    expect(mixed.items[0].branding_on).toBe('cut');
    expect(mixed.warnings).toContainEqual({ kind: 'branding_on_mixed', item: mixed.items[0].key });
  });

  it('у готового изделия «на крое» не бывает — правило ERP normalizeBrandingOn', () => {
    const d = tzToErpDraft(order([sku({ kind: 'customer', prints: [newSalesPrint({ on: 'cut' })] })]));
    expect(d.items[0].branding_on).toBe('finished');
  });

  it('бирки переносятся без варианта библиотеки', () => {
    const l = newSalesLabel({ label_type: 'care', place: 'Левый шов', size: '30×60', variant_id: 'v1' });
    const [dl] = tzToErpDraft(order([sku({ labels: [l] })])).items[0].labels;
    expect(dl).toEqual({ key: l.key, label_type: 'care', place: 'Левый шов', size: '30×60', comment: '' });
  });
});
