import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint, gridQty } from './factory';
import { artworkInUse, duplicateInColor, itemTitle, splitByColor } from './itemOps';
import type { SalesItem, SalesOrder } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function multiColor(): SalesItem {
  return newSalesItem({
    sku_code: 'HD-01',
    product_type: 'Худи',
    color_supplier: 'Чёрный / Медас',
    tz_pdf_path: 'tz/a.pdf',
    manual_unit_price: 1500,
    size_grid: {
      sizes: ['S', 'M', 'L'],
      rows: [
        { color: 'Чёрный', sizes: { S: 10, M: 20, L: 15 } },
        { color: 'Белый', sizes: { S: 5, M: 5, L: 0 } },
        { color: 'Серый', sizes: { S: 1, M: 2, L: 3 } },
      ],
    },
    prints: [newSalesPrint({ zone: 'Грудь', artwork_path: 'o-1/logo.png' }), newSalesPrint({ zone: 'Спина' })],
    labels: [newSalesLabel({ label_type: 'Жаккард' })],
  });
}

/** Все ключи заказа: позиции, нанесения, бирки */
function allKeys(items: SalesItem[]): string[] {
  return items.flatMap((it) => [it.key, ...it.prints.map((p) => p.key), ...it.labels.map((l) => l.key)]);
}

describe('duplicateInColor — копия позиции в другом цвете', () => {
  it('новые uuid-ключи у позиции, нанесений и бирок; ключи по заказу уникальны', () => {
    const src = multiColor();
    const copy = duplicateInColor(src, 'Красный');
    const keys = allKeys([src, copy]);
    for (const k of allKeys([copy])) expect(k).toMatch(UUID);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('одна строка сетки нового цвета, размеры те же, штук 0', () => {
    const copy = duplicateInColor(multiColor(), 'Красный');
    expect(copy.size_grid.sizes).toEqual(['S', 'M', 'L']);
    expect(copy.size_grid.rows).toEqual([{ color: 'Красный', sizes: { S: 0, M: 0, L: 0 } }]);
    expect(gridQty(copy.size_grid)).toBe(0);
  });

  it('PDF ТЗ и ручная цена сбрасываются, макет нанесения копируется', () => {
    const src = multiColor();
    const copy = duplicateInColor(src, 'Красный');
    expect(copy.tz_pdf_path).toBe('');
    expect(copy.manual_unit_price).toBeNull();
    expect(copy.prints.map((p) => p.artwork_path)).toEqual(['o-1/logo.png', '']);
    expect(copy.prints.map((p) => p.zone)).toEqual(['Грудь', 'Спина']);
    expect(copy.labels[0].label_type).toBe('Жаккард');
  });

  it('модель и ткань сохраняются, цвет в «цвет / поставщик» меняется', () => {
    const copy = duplicateInColor(multiColor(), 'Красный');
    expect(copy.sku_code).toBe('HD-01');
    expect(copy.color_supplier).toBe('Красный / Медас');
  });

  it('исходная позиция не меняется', () => {
    const src = multiColor();
    const snapshot = JSON.parse(JSON.stringify(src));
    const copy = duplicateInColor(src, 'Красный');
    copy.prints[0].zone = 'Рукав';
    copy.size_grid.sizes.push('XL');
    expect(src).toEqual(snapshot);
  });
});

describe('splitByColor — разнесение позиции по цветам', () => {
  it('одна позиция на строку сетки, первая сохраняет ключ', () => {
    const src = multiColor();
    const parts = splitByColor(src);
    expect(parts).toHaveLength(3);
    expect(parts[0].key).toBe(src.key);
    expect(parts.map((p) => p.size_grid.rows.map((r) => r.color))).toEqual([['Чёрный'], ['Белый'], ['Серый']]);
    for (const p of parts) expect(p.size_grid.sizes).toEqual(['S', 'M', 'L']);
  });

  it('сумма штук сохраняется', () => {
    const src = multiColor();
    const parts = splitByColor(src);
    expect(parts.reduce((s, p) => s + gridQty(p.size_grid), 0)).toBe(gridQty(src.size_grid));
    expect(gridQty(parts[1].size_grid)).toBe(10);
  });

  it('нанесения и бирки копируются в каждую; ключи — uuid и уникальны по заказу', () => {
    const src = multiColor();
    const other = newSalesItem({ prints: [newSalesPrint()] });
    const parts = splitByColor(src);
    for (const p of parts) {
      expect(p.prints.map((x) => x.zone)).toEqual(['Грудь', 'Спина']);
      expect(p.prints[0].artwork_path).toBe('o-1/logo.png');
      expect(p.labels).toHaveLength(1);
      for (const k of allKeys([p])) expect(k).toMatch(UUID);
    }
    const keys = allKeys([...parts, other]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('у новых позиций свой «цвет / поставщик» и нет PDF ТЗ', () => {
    const parts = splitByColor(multiColor());
    expect(parts.map((p) => p.color_supplier)).toEqual(['Чёрный / Медас', 'Белый / Медас', 'Серый / Медас']);
    expect(parts.slice(1).every((p) => p.tz_pdf_path === '')).toBe(true);
  });

  it('позиция с одной строкой возвращается как есть', () => {
    const one = newSalesItem({ size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 3 } }] } });
    expect(splitByColor(one)).toEqual([one]);
  });
});

describe('artworkInUse — макет ещё нужен другому нанесению', () => {
  function order(): SalesOrder {
    const a = newSalesItem({ prints: [newSalesPrint({ key: 'p1', artwork_path: 'o/x.png' })] });
    const b = newSalesItem({ prints: [newSalesPrint({ key: 'p2', artwork_path: 'o/x.png' }), newSalesPrint({ key: 'p3', artwork_path: 'o/y.png' })] });
    return newSalesOrder({ items: [a, b] });
  }

  it('общий макет занят, пока на него ссылается другое нанесение', () => {
    expect(artworkInUse(order(), 'o/x.png', 'p1')).toBe(true);
    expect(artworkInUse(order(), 'o/x.png', 'p2')).toBe(true);
  });

  it('макет единственного нанесения свободен', () => {
    expect(artworkInUse(order(), 'o/y.png', 'p3')).toBe(false);
    expect(artworkInUse(order(), 'o/z.png', 'p1')).toBe(false);
  });

  it('пустой путь никогда не «занят»', () => {
    expect(artworkInUse(order(), '', 'p1')).toBe(false);
  });
});

describe('itemTitle — название позиции', () => {
  it('модель · цвет · штук', () => {
    const it1 = newSalesItem({
      product_type: 'Худи',
      size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 20, M: 25 } }] },
    });
    expect(itemTitle(it1)).toBe('Худи · Чёрный · 45 шт');
  });

  it('без цвета — «цвет не выбран»', () => {
    expect(itemTitle(newSalesItem({ product_type: 'Худи' }))).toBe('Худи · цвет не выбран');
    expect(itemTitle(newSalesItem({
      product_type: 'Худи', size_grid: { sizes: ['M'], rows: [{ color: '  ', sizes: { M: 2 } }] },
    }))).toBe('Худи · цвет не выбран');
  });

  it('без модели — «Новое изделие»', () => {
    expect(itemTitle(newSalesItem())).toBe('Новое изделие');
  });

  it('несколько цветов перечисляются', () => {
    expect(itemTitle(multiColor())).toBe('Худи · Чёрный, Белый, Серый · 61 шт');
  });
});
