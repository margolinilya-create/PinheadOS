import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { newSalesPrint } from '../../../model/factory';
import { flat as makeFlat, CENTER_X, NECKLINE_Y } from '../../fixtures.testutil';
import { newPlacedPrint, placementOf } from '../../model/layout';
import {
  duplicateLayer, horizontalOffset, moveLayer, patchPrint, placeGeometry, presetsFor, resized, rotated,
  verticalLabel, verticalOffset, viewPlacements, whereOf, withHorizontalOffset, withPreset, withVerticalOffset,
} from './panelOps';

const FLAT = makeFlat();
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };
const ctx = { flat: FLAT, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts' };
const placed = (view: 'front' | 'back' = 'front', area = view === 'front' ? 'chest' : 'back') => newPlacedPrint(
  ASSET, `orders/${ORDER}/logo/${view}.png`, area, { ...ctx, view, itemKind: 'sku', method: 'dtf' },
)!;
const plOf = (p: ReturnType<typeof placed>) => placementOf(p, FLAT)!;

describe('panelOps — геометрия инспектора', () => {
  it('Ш с замком: В по пропорции, центр на месте; мм и цена — в стандартных полях', () => {
    const p = placed();
    const pl = plOf(p);
    const g = resized(pl, { width: 60 }, true);
    expect(g.width_mm).toBe(60);
    expect(g.height_mm).toBeCloseTo(40);
    expect(g.x_mm + g.width_mm / 2).toBeCloseTo(pl.x_mm + pl.width_mm / 2);
    const next = placeGeometry([p], p.key, g, ctx)!;
    expect(next[0].width_mm).toBe(60);
    expect(next[0].height_mm).toBe(40);
  });

  it('Ш без замка — В прежняя', () => {
    const g = resized(plOf(placed()), { width: 60 }, false);
    expect(g.height_mm).toBe(80);
  });

  it('отступ от горловины: прочитать и задать', () => {
    const p = placed();
    const { view, area } = whereOf(plOf(p), ctx)!;
    const g = withVerticalOffset(view, area, plOf(p), 50);
    expect(verticalOffset(view, area, g)).toBeCloseTo(50);
    expect(g.y_mm).toBeCloseTo(NECKLINE_Y + 50);
    const next = placeGeometry([p], p.key, g, ctx)!;
    expect(next[0].offset_mm).toBe(50);
    expect(next[0].offset_from).toBe('neck_seam');
  });

  it('смещение от центра: плюс — вправо', () => {
    const pl = plOf(placed());
    const { view, area } = whereOf(pl, ctx)!;
    const g = withHorizontalOffset(view, area, pl, 30);
    expect(g.x_mm + g.width_mm / 2).toBeCloseTo(CENTER_X + 30);
    expect(horizontalOffset(view, area, g)).toBeCloseTo(30);
  });

  it('пресеты по виду; центр спины от горловины спинки', () => {
    const front = whereOf(plOf(placed()), ctx)!;
    expect(presetsFor(front.view, front.area).map((x) => x.label)).toEqual(['Центр груди', 'Левая грудь', 'Центр зоны']);
    const backPl = plOf(placed('back'));
    const back = whereOf(backPl, ctx)!;
    expect(presetsFor(back.view, back.area).map((x) => x.label)).toEqual(['Центр спины', 'Центр зоны']);
    const label = back.view.print_areas.find((a) => a.id === 'label')!;
    expect(presetsFor(back.view, label).map((x) => x.key)).toEqual(['center-zone']);
    expect(withPreset(back.view, back.area, backPl, 'back-standard').y_mm).toBe(40 + 75);
  });

  it('подписи опоры: горловина, пояс у штанов, верх зоны у этикетки', () => {
    const { view, area } = whereOf(plOf(placed()), ctx)!;
    expect(verticalLabel(view, area, 'tshirts')).toBe('От горловины, мм');
    expect(verticalLabel(view, area, 'pants')).toBe('От пояса, мм');
    expect(verticalLabel(view, { ...area, zone_id: null }, 'tshirts')).toBe('От верха зоны, мм');
  });

  it('поворот шагом 90° в пределах 0…360', () => {
    const pl = plOf(placed());
    expect(rotated(pl, -90).rotation_deg).toBe(270);
    expect(rotated(rotated(pl, 90), 270).rotation_deg).toBe(0);
  });
});

describe('panelOps — слои', () => {
  it('выше/ниже меняют порядок среди нанесений вида; строка без холста на месте', () => {
    const a = placed();
    const row = newSalesPrint({ zone: 'Рукав' });
    const b = placed();
    const back = placed('back');
    const prints = [a, row, back, b];
    const up = moveLayer(prints, a.key, 1, ctx)!;
    expect(up.map((p) => p.key)).toEqual([b.key, row.key, back.key, a.key]);
    expect(moveLayer(prints, b.key, 1, ctx)).toBeNull();
    expect(moveLayer(prints, row.key, 1, ctx)).toBeNull();
    expect(viewPlacements(up, ctx, 'front').map((x) => x.print.key)).toEqual([b.key, a.key]);
  });

  it('дубль: новый ключ сразу после исходного, сдвиг на 10 мм', () => {
    const a = placed();
    const res = duplicateLayer([a], a.key, ctx)!;
    expect(res.prints).toHaveLength(2);
    expect(res.prints[1].key).toBe(res.key);
    expect(res.key).not.toBe(a.key);
    expect(plOf(res.prints[1]).x_mm).toBeCloseTo(plOf(a).x_mm + 10);
    expect(duplicateLayer([newSalesPrint()], 'x', ctx)).toBeNull();
  });

  it('поля строки: без изменений — null', () => {
    const a = placed();
    expect(patchPrint([a], a.key, { method: a.method })).toBeNull();
    expect(patchPrint([a], a.key, { method: 'dtg' })![0].method).toBe('dtg');
    expect(patchPrint([a], 'nope', { method: 'dtg' })).toBeNull();
  });
});
