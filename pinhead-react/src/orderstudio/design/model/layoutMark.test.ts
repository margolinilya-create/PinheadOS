import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { newSalesItem, newSalesPrint } from '../../model/factory';
import { flat as makeFlat } from '../fixtures.testutil';
import { newPlacedPrint, parseLayout } from './layout';
import * as z from 'zod/mini';
import { DESIGN_VIEWS } from '../types';
import { AREA_ID_RE, FLAT_ID_RE, MAX_COORD_MM, MAX_FLAT_VERSION, MAX_PX_SIDE, MAX_SOURCE_FILE_LEN } from '../limits';
import { hasPlacedLayout, unplacedCount } from './layoutMark';

/** Эталон — схема `zod/mini` задачи 3 (до переноса разбора руками): разбор обязан совпасть с ней */
const coord = z.number().check(z.gte(-MAX_COORD_MM), z.lte(MAX_COORD_MM));
const sizeMm = z.number().check(z.gt(0), z.lte(MAX_COORD_MM));
const px = z.int().check(z.gte(1), z.lte(MAX_PX_SIDE));
const REFERENCE = z.object({
  v: z.literal(1),
  flat_id: z.string().check(z.regex(FLAT_ID_RE)),
  flat_version: z.int().check(z.gte(1), z.lte(MAX_FLAT_VERSION)),
  view: z.enum(DESIGN_VIEWS),
  area_id: z.string().check(z.regex(AREA_ID_RE)),
  x_mm: coord,
  y_mm: coord,
  rotation_deg: z.number().check(z.gte(-360), z.lte(360)),
  flip_h: z.boolean(),
  flip_v: z.boolean(),
  asset: z.object({
    type: z.enum(['svg', 'png']),
    source_file: z.string().check(z.maxLength(MAX_SOURCE_FILE_LEN)),
    intrinsic_w_mm: sizeMm,
    intrinsic_h_mm: sizeMm,
    px_w: z.optional(px),
    px_h: z.optional(px),
    dpi: z.optional(z.number().check(z.gt(0), z.lte(10000))),
    size_estimated: z.boolean(),
    has_preview: z.boolean(),
  }),
});
const reference = (raw: unknown) => {
  const r = z.safeParse(REFERENCE, raw);
  return r.success ? r.data : null;
};

const FLAT = makeFlat();
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };
const placed = () => newPlacedPrint(ASSET, 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/a.png', 'chest', {
  flat: FLAT, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts', view: 'front', itemKind: 'sku', method: 'dtf',
})!;

describe('hasPlacedLayout — форма раскладки без zod', () => {
  it('раскладка холста — «на холсте», как и у строгого разбора', () => {
    const p = placed();
    expect(parseLayout(p.layout)).not.toBeNull();
    expect(hasPlacedLayout(p.layout)).toBe(true);
    expect(hasPlacedLayout(p.layout, FLAT.id)).toBe(true);
  });

  it('другой флэт позиции — строка остаётся правимой', () => {
    expect(hasPlacedLayout(placed().layout, 'hoodie-test')).toBe(false);
  });

  it('битая раскладка — не на холсте', () => {
    const base = placed().layout as Record<string, unknown>;
    const bad: unknown[] = [
      null, 'x', [], { ...base, v: 2 }, { ...base, view: 'sleeve' }, { ...base, x_mm: '10' },
      { ...base, flat_id: '../evil' }, { ...base, area_id: 'Chest!' }, { ...base, flip_h: 1 },
      { ...base, asset: { ...(base.asset as object), type: 'pdf' } }, { ...base, asset: null },
      { ...base, x_mm: Number.NaN },
    ];
    for (const raw of bad) {
      expect(hasPlacedLayout(raw)).toBe(false);
      expect(parseLayout(raw)).toBeNull();
    }
  });

  it('совпадает с эталонной схемой zod на порче каждого поля (и лишние ключи отброшены)', () => {
    const base = placed().layout as Record<string, unknown>;
    const asset = base.asset as Record<string, unknown>;
    const BAD: unknown[] = [undefined, null, '', '1', true, -1, 0, 0.5, 1, 1.5, 9999, 10000, 12001, 5000, 5001, -5001,
      360, 361, -361, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, [], {}, 'front', 'back', 'sleeve_left', 'chest', 'Bad Id', 'svg', 'pdf'];
    const variants: unknown[] = [base, { ...base, extra: 'x' }, { ...base, asset: { ...asset, extra: 1 } }];
    for (const key of Object.keys(base)) for (const v of BAD) variants.push({ ...base, [key]: v });
    for (const key of [...Object.keys(asset), 'px_w', 'px_h', 'dpi']) for (const v of BAD) variants.push({ ...base, asset: { ...asset, [key]: v } });
    variants.push({ ...base, asset: { ...asset, source_file: 'x'.repeat(255) } }, { ...base, asset: { ...asset, source_file: 'x'.repeat(256) } });
    for (const raw of variants) expect(parseLayout(raw)).toEqual(reference(raw));
    expect(Object.keys(parseLayout({ ...base, extra: 'x' })!)).not.toContain('extra');
  });

  it('счётчик неразмещённых по заказу', () => {
    const item = newSalesItem({ flat_id: FLAT.id, prints: [placed(), newSalesPrint({ zone: 'Рукав' })] });
    const other = newSalesItem({ prints: [newSalesPrint()] });
    expect(unplacedCount([item, other])).toBe(2);
    expect(unplacedCount([newSalesItem()])).toBe(0);
  });
});
