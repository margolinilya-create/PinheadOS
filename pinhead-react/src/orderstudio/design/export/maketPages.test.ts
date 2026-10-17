import { describe, it, expect } from 'vitest';
import { newSalesPrint } from '../../model/factory';
import type { SalesItem, SalesPrint } from '../../model/types';
import { flat } from '../fixtures.testutil';
import type { PrintLayoutV1 } from '../types';
import { maketCaption, maketFileName, maketPages, placedEntries } from './maketPages';

const layout = (patch: Partial<PrintLayoutV1> = {}): Record<string, unknown> => ({
  v: 1, flat_id: 'tshirt-test', flat_version: 1, view: 'front', area_id: 'chest',
  x_mm: 250, y_mm: 167, rotation_deg: 0, flip_h: false, flip_v: false,
  asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 80, size_estimated: false, has_preview: false },
  ...patch,
} as unknown as Record<string, unknown>);

function print(patch: Partial<SalesPrint> = {}): SalesPrint {
  return newSalesPrint({
    method: 'dtf', zone: 'Грудь (перед)', width_mm: 120, height_mm: 80,
    artwork_path: 'orders/ab/logo/1-logo.png', layout: layout(),
    offset_mm: 80, offset_from: 'neck_seam', offset_dir: 'down',
    ...patch,
  });
}

const item = (prints: SalesPrint[], patch: Partial<SalesItem> = {}) => ({
  prints,
  product_type: 'Футболка Regular',
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный (15-01)', sizes: { M: 10 } }] },
  ...patch,
}) as unknown as SalesItem;

describe('maketPages — листы PDF макета', () => {
  it('лист на каждый вид с размещениями, перед раньше спины', () => {
    const back = print({ key: 'b', zone: 'Спина', layout: layout({ view: 'back', area_id: 'back', y_mm: 150 }) });
    const front = print({ key: 'f' });
    const pages = maketPages(item([back, front]), flat());
    expect(pages.map((p) => p.view.kind)).toEqual(['front', 'back']);
    expect(pages[0].entries.map((e) => e.print.key)).toEqual(['f']);
    expect(pages[1].entries.map((e) => e.print.key)).toEqual(['b']);
  });

  it('номер нанесения — его место в позиции (номер в ТЗ), строки без холста номер не теряют', () => {
    const row = print({ key: 'row', layout: null });
    const placed = print({ key: 'placed' });
    const [page] = maketPages(item([row, placed]), flat());
    expect(page.entries.map((e) => [e.print.key, e.n])).toEqual([['placed', 2]]);
  });

  it('вид без размещений листа не получает; нет размещений — листов нет', () => {
    expect(maketPages(item([print()]), flat()).map((p) => p.view.kind)).toEqual(['front']);
    expect(maketPages(item([print({ layout: null })]), flat())).toEqual([]);
  });

  it('размещение на другом флэте или с битой раскладкой в PDF не идёт', () => {
    const other = print({ key: 'o', layout: layout({ flat_id: 'hoodie-other' }) });
    const broken = print({ key: 'x', layout: { v: 1, x_mm: '"><script>' } });
    expect(maketPages(item([other, broken]), flat())).toEqual([]);
  });

  it('placedEntries — все размещения позиции по порядку нанесений', () => {
    const a = print({ key: 'a', layout: layout({ view: 'back', area_id: 'back', y_mm: 150 }) });
    const b = print({ key: 'b' });
    expect(placedEntries(item([a, b]), flat()).map((e) => [e.print.key, e.n])).toEqual([['a', 1], ['b', 2]]);
  });
});

describe('maketCaption — строка легенды листа', () => {
  const entryOf = (p: SalesPrint) => maketPages(item([p]), flat())[0].entries[0];

  it('зона, техника, Ш×В и отступ от шва горловины', () => {
    expect(maketCaption(entryOf(print()))).toBe('Грудь (перед) — DTF, 120×80 мм, 80 мм ниже шва горловины');
  });

  it('отступ выше опоры, от верхнего края; без направления — «от»', () => {
    expect(maketCaption(entryOf(print({ offset_dir: 'up', offset_mm: 5 })))).toContain('5 мм выше шва горловины');
    expect(maketCaption(entryOf(print({ offset_from: 'top_edge', offset_mm: 12 })))).toContain('12 мм ниже верхнего края');
    expect(maketCaption(entryOf(print({ offset_dir: '', offset_mm: 30 })))).toContain('30 мм от шва горловины');
  });

  it('отступ не задан — без хвоста; зоны нет — прочерк', () => {
    expect(maketCaption(entryOf(print({ offset_mm: null })))).toBe('Грудь (перед) — DTF, 120×80 мм');
    expect(maketCaption(entryOf(print({ zone: '', offset_mm: null })))).toBe('— — DTF, 120×80 мм');
  });

  it('мм из размещения целыми', () => {
    expect(maketCaption(entryOf(print({ width_mm: 99.6, height_mm: 40.2, offset_mm: null })))).toBe('Грудь (перед) — DTF, 100×40 мм');
  });
});

describe('maketFileName — имя PDF макета', () => {
  it('ASCII: номер заказа, модель, цвет, «maket»', () => {
    expect(maketFileName({ number: 'PH-1234' }, item([]))).toBe('PH-1234-Futbolka_Regular-Chernyy_15-01-maket.pdf');
  });

  it('без номера, модели и цвета — запасные слова', () => {
    const bare = item([], { product_type: '  ', size_grid: { sizes: [], rows: [] } });
    expect(maketFileName({ number: '' }, bare)).toBe('PH-draft-izdelie-maket.pdf');
  });

  it('чужие символы и «../» в ключ не попадают', () => {
    const name = maketFileName({ number: '../PH-1' }, item([], { product_type: 'Худи/«Оверсайз»' }));
    expect(name).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
  });
});
