import { describe, it, expect } from 'vitest';
import { applyPlacement, newPlacedPrint, parseLayout, placementOf, remapToFlat, zoneNameOf, type PlaceCtx } from './layout';
import { newSalesPrint } from '../../model/factory';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import type { AssetMeta, PrintLayoutV1 } from '../types';
import { area, backView, clone, flat, frontView } from '../fixtures.testutil';

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const ASSET: AssetMeta = {
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 50,
  px_w: 1181, px_h: 591, dpi: 300, size_estimated: false, has_preview: false,
};
const FLAT = flat();
const CTX: PlaceCtx = { flat: FLAT, zonesCatalog: ZONES, category: 'tshirts' };

const LAYOUT: PrintLayoutV1 = {
  v: 1, flat_id: 'tshirt-test', flat_version: 1, view: 'front', area_id: 'chest',
  x_mm: 250, y_mm: 167, rotation_deg: 0, flip_h: false, flip_v: false, asset: ASSET,
};

describe('parseLayout — строгий разбор (H1)', () => {
  it('корректная раскладка проходит как есть', () => {
    expect(parseLayout(LAYOUT)).toEqual(LAYOUT);
  });

  it('лишние ключи отброшены, в том числе в asset', () => {
    const r = parseLayout({ ...LAYOUT, href: 'javascript:alert(1)', asset: { ...ASSET, onload: 'x' } });
    expect(r).toEqual(LAYOUT);
  });

  const broken: [string, unknown][] = [
    ['null', null],
    ['массив', [LAYOUT]],
    ['версия 2', { ...LAYOUT, v: 2 }],
    ['строка в числе', { ...LAYOUT, x_mm: '250' }],
    ['строка-разметка в числе', { ...LAYOUT, y_mm: '"><image href=x onerror=alert(1)>' }],
    ['бесконечность', { ...LAYOUT, x_mm: Infinity }],
    ['NaN', { ...LAYOUT, rotation_deg: NaN }],
    ['координата за 5000', { ...LAYOUT, y_mm: 5001 }],
    ['вид рукава (5б)', { ...LAYOUT, view: 'sleeve_left' }],
    ['id флэта с разметкой', { ...LAYOUT, flat_id: 'x"><script>' }],
    ['id зоны с пробелом', { ...LAYOUT, area_id: 'chest zone' }],
    ['версия флэта дробная', { ...LAYOUT, flat_version: 1.5 }],
    ['имя файла длиннее 255', { ...LAYOUT, asset: { ...ASSET, source_file: 'a'.repeat(256) } }],
    ['тип файла не из перечня', { ...LAYOUT, asset: { ...ASSET, type: 'html' } }],
    ['нет has_preview', { ...LAYOUT, asset: { ...ASSET, has_preview: undefined } }],
    ['пиксели за 12000', { ...LAYOUT, asset: { ...ASSET, px_w: 12001 } }],
    ['нулевой размер макета', { ...LAYOUT, asset: { ...ASSET, intrinsic_w_mm: 0 } }],
  ];

  it.each(broken)('%s → null', (_name, raw) => {
    expect(parseLayout(raw)).toBeNull();
  });
});

describe('placementOf', () => {
  const print = newSalesPrint({ method: 'dtf', width_mm: 120, height_mm: 60, artwork_path: 'orders/o/a.png', layout: { ...LAYOUT } });

  it('мм — из стандартных полей нанесения, геометрия — из раскладки', () => {
    expect(placementOf(print, FLAT)).toEqual({
      print_key: print.key, view: 'front', area_id: 'chest', x_mm: 250, y_mm: 167,
      width_mm: 120, height_mm: 60, rotation_deg: 0, flip_h: false, flip_v: false,
      method: 'dtf', asset: ASSET, artwork_path: 'orders/o/a.png', stale: false,
    });
  });

  it('нет мм у нанесения — размер файла', () => {
    expect(placementOf({ ...print, width_mm: null, height_mm: null }, FLAT)).toMatchObject({ width_mm: 100, height_mm: 50 });
  });

  it('не размещено, чужой флэт, нет зоны, битая раскладка — null', () => {
    expect(placementOf({ ...print, layout: null }, FLAT)).toBeNull();
    expect(placementOf(print, flat({ id: 'other' }))).toBeNull();
    expect(placementOf({ ...print, layout: { ...LAYOUT, area_id: 'pocket' } }, FLAT)).toBeNull();
    expect(placementOf({ ...print, layout: { ...LAYOUT, x_mm: 'x' } }, FLAT)).toBeNull();
  });

  it('раскладка прежней версии флэта — stale', () => {
    expect(placementOf(print, flat({ version: 2 }))?.stale).toBe(true);
  });
});

describe('applyPlacement', () => {
  const pl = placementOf(newSalesPrint({ method: 'dtf', layout: { ...LAYOUT } }), FLAT)!;

  it('зона — имя из справочника зон по zone_id, мм целые, отступ от горловины', () => {
    const before = newSalesPrint({ method: 'silkscreen', offset_note: 'как в прошлый раз' });
    const snapshot = clone(before);
    const out = applyPlacement(before, { ...pl, x_mm: 250.04, y_mm: 167.06, width_mm: 99.6, height_mm: 50.4 }, CTX);
    expect(out).toMatchObject({
      zone: 'Грудь (перед)', width_mm: 100, height_mm: 50, method: 'dtf',
      offset_mm: 75, offset_from: 'neck_seam', offset_dir: 'down', offset_note: 'как в прошлый раз',
    });
    expect(out.layout).toMatchObject({ v: 1, flat_id: 'tshirt-test', flat_version: 1, x_mm: 250, y_mm: 167.1, area_id: 'chest' });
    expect(before).toEqual(snapshot);
  });

  it('раскладка на выходе проходит строгий разбор', () => {
    const out = applyPlacement(newSalesPrint(), { ...pl, rotation_deg: -30 }, CTX);
    expect(parseLayout(out.layout)).not.toBeNull();
    expect((out.layout as unknown as PrintLayoutV1).rotation_deg).toBe(330);
  });

  it('служебная зона (бирка) — имя зоны флэта, отступ от верха зоны', () => {
    const out = applyPlacement(newSalesPrint(), { ...pl, view: 'back', area_id: 'label', x_mm: 280, y_mm: 55, width_mm: 40, height_mm: 20 }, CTX);
    expect(out).toMatchObject({ zone: 'Этикетка', offset_from: 'top_edge', offset_mm: 7 });
  });

  it('неизвестная зона — нанесение без изменений', () => {
    const p = newSalesPrint();
    expect(applyPlacement(p, { ...pl, area_id: 'nope' }, CTX)).toBe(p);
  });

  it('zoneNameOf: нет зоны в справочнике — подпись ZONE_LABELS или id', () => {
    expect(zoneNameOf(area({ zone_id: 'pocket' }), [])).toBe('Карман');
    expect(zoneNameOf(area({ zone_id: 'pants-front' }), [])).toBe('pants-front');
  });
});

describe('newPlacedPrint', () => {
  const ctx = { ...CTX, view: 'front' as const, itemKind: 'sku' as const, method: 'dtg' as const };

  it('логотип в зону: стандартное место груди, техника, файл, на крое у пошива', () => {
    const p = newPlacedPrint(ASSET, 'orders/o/a.png', 'chest', ctx)!;
    expect(p).toMatchObject({
      method: 'dtg', on: 'cut', zone: 'Грудь (перед)', width_mm: 100, height_mm: 50,
      artwork_path: 'orders/o/a.png', offset_mm: 75, offset_from: 'neck_seam',
    });
    expect(placementOf(p, FLAT)).toMatchObject({ x_mm: 250, y_mm: 167 });
  });

  it('бланк и давальческое — на готовом', () => {
    expect(newPlacedPrint(ASSET, '', 'chest', { ...ctx, itemKind: 'blank' })!.on).toBe('finished');
  });

  it('логотип больше зоны вписывается в безопасную область', () => {
    const big = { ...ASSET, intrinsic_w_mm: 1000, intrinsic_h_mm: 500 };
    expect(newPlacedPrint(big, '', 'chest', ctx)).toMatchObject({ width_mm: 270, height_mm: 135 });
  });

  it('спина — центр спины от горловины спинки', () => {
    const p = newPlacedPrint(ASSET, '', 'back', { ...ctx, view: 'back' })!;
    expect(p).toMatchObject({ zone: 'Спина', offset_mm: 75 });
  });

  it('нет такой зоны — null', () => {
    expect(newPlacedPrint(ASSET, '', 'pocket', ctx)).toBeNull();
  });
});

describe('remapToFlat', () => {
  const placed = newPlacedPrint(ASSET, 'orders/o/a.png', 'chest', { ...CTX, view: 'front', itemKind: 'sku', method: 'dtf' })!;
  const loose = newSalesPrint({ zone: 'Левый рукав' });

  it('зона найдена по zone_id: размер и отступы сохранены, флэт и зона — новые', () => {
    const wide = flat({
      id: 'tshirt-wide',
      views: [
        frontView({
          svg_path: 'flats/tshirt-wide/v1/front.svg',
          anchors: { neckline_point: { x: 400, y: 120 }, center_axis_x: 400 },
          print_areas: [area({ id: 'front-big', zone_id: 'front', polygon_mm: [[200, 160], [600, 160], [600, 600], [200, 600]] })],
        }),
        backView({ svg_path: 'flats/tshirt-wide/v1/back.svg' }),
      ],
    });
    const r = remapToFlat([placed, loose], FLAT, { ...CTX, flat: wide });
    expect(r.moved).toEqual([placed.key]);
    expect(r.dropped).toEqual([]);
    expect(r.prints[1]).toBe(loose);
    const pl = placementOf(r.prints[0], wide)!;
    expect(pl).toMatchObject({ area_id: 'front-big', x_mm: 350, y_mm: 195, width_mm: 100, height_mm: 50 });
    expect(r.prints[0]).toMatchObject({ zone: 'Грудь (перед)', offset_mm: 75, offset_from: 'neck_seam' });
  });

  it('зоны нет — снято с холста, строка нанесения остаётся', () => {
    const noFront = flat({ id: 'tshirt-back-only', views: [backView({ svg_path: 'flats/tshirt-back-only/v1/back.svg' })] });
    const r = remapToFlat([placed], FLAT, { ...CTX, flat: noFront });
    expect(r.dropped).toEqual([placed.key]);
    expect(r.prints[0]).toMatchObject({ layout: null, zone: 'Грудь (перед)', width_mm: 100, artwork_path: 'orders/o/a.png' });
  });

  it('служебная зона без zone_id не переносится наугад', () => {
    const lbl = newPlacedPrint(ASSET, '', 'label', { ...CTX, view: 'back', itemKind: 'sku', method: 'dtf' })!;
    const r = remapToFlat([lbl], FLAT, { ...CTX, flat: flat({ id: 'tshirt-2' }) });
    expect(r.dropped).toEqual([lbl.key]);
  });
});
