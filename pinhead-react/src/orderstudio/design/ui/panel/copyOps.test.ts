import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { newPlacedPrint, placementOf, parseLayout } from '../../model/layout';
import { flat as makeFlat } from '../../fixtures.testutil';
import { sleeveView } from '../../fixtures5b.testutil';
import type { GarmentFlat } from '../../types';
import { copyTargets, copyToView, pasteLayer } from './copyOps';

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40, size_estimated: false, has_preview: false };

/** Рукава с разными осями и низом: левый — ось 150, низ 500; правый — ось 170, низ 520, зона сдвинута */
function sleeves(): GarmentFlat {
  const base = makeFlat();
  return {
    ...base,
    views: [
      ...base.views,
      sleeveView('sleeve_left', 'flats/tshirt-test/v1/sleeve_left.svg'),
      sleeveView('sleeve_right', 'flats/tshirt-test/v1/sleeve_right.svg', {
        anchors: { sleeve_bottom_y: 520, sleeve_center_x: 170 },
        print_areas: [{
          id: 'sleeve-r', name: 'Правый рукав', zone_id: 'sleeve-r', safe_inset_mm: 5,
          polygon_mm: [[100, 220], [240, 220], [240, 500], [100, 500]],
        }],
      }),
    ],
  };
}

function ctxOf(flat: GarmentFlat, extra = {}) {
  return { flat, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts', ...extra };
}

function placedOn(flat: GarmentFlat, view: string, areaId: string) {
  return newPlacedPrint(ASSET, `orders/${ORDER}/logo/a.png`, areaId, { ...ctxOf(flat), view: view as never, itemKind: 'sku', method: 'dtf' })!;
}

describe('copyToView — копия нанесения на другой вид (веха 5в, Э2)', () => {
  it('левый рукав → правый: зеркально по осям обоих рукавов, отступ от низа рукава, поворот зеркальный', () => {
    const flat = sleeves();
    const ctx = ctxOf(flat);
    const src0 = placedOn(flat, 'sleeve_left', 'sleeve-l');
    const pl0 = placementOf(src0, flat)!;
    const src = { ...src0, layout: { ...(src0.layout as object), x_mm: 120, rotation_deg: 30 } };
    const pl = { ...pl0, x_mm: 120, rotation_deg: 30 };
    const res = copyToView([src], src.key, 'sleeve_right', ctx)!;
    expect(res.prints).toHaveLength(2);
    expect(res.key).not.toBe(src.key);
    const copy = res.prints[1];
    const cp = placementOf(copy, flat)!;
    expect(cp.view).toBe('sleeve_right');
    expect(cp.area_id).toBe('sleeve-r');
    expect(copy.zone_id).toBe('sleeve-r');
    expect(cp.x_mm).toBeCloseTo(150 + 170 - pl.x_mm - pl.width_mm, 0);
    expect(cp.y_mm).toBeCloseTo(pl.y_mm + 20, 0);
    expect(cp.rotation_deg).toBeCloseTo(330);
    expect(cp.flip_h).toBe(pl.flip_h);
    expect([copy.width_mm, copy.height_mm, copy.method, copy.artwork_path]).toEqual([src.width_mm, src.height_mm, src.method, src.artwork_path]);
  });

  it('перед → спина: та же техника и размер, зона спины; вид без разрешённой зоны — не цель', () => {
    const flat = sleeves();
    const src = placedOn(flat, 'front', 'chest');
    const pl = placementOf(src, flat)!;
    expect(copyTargets(pl, ctxOf(flat))).toEqual(['back', 'sleeve_left', 'sleeve_right']);
    const res = copyToView([src], src.key, 'back', ctxOf(flat))!;
    const cp = placementOf(res.prints[1], flat)!;
    expect(cp.view).toBe('back');
    expect(cp.area_id).toBe('back');
    const noBack = ctxOf(flat, { areaAllowed: (a: { id: string }) => a.id !== 'back' && a.id !== 'label' });
    expect(copyTargets(pl, noBack)).toEqual(['sleeve_left', 'sleeve_right']);
    expect(copyToView([src], src.key, 'back', noBack)).toBeNull();
  });
});

describe('pasteLayer — вставка скопированного нанесения', () => {
  it('тот же силуэт, тот же вид — копия рядом со сдвигом, новый ключ', () => {
    const flat = sleeves();
    const src = placedOn(flat, 'front', 'chest');
    const res = pasteLayer([src], src, 'front', ctxOf(flat), null)!;
    expect(res.prints).toHaveLength(2);
    const a = placementOf(src, flat)!;
    const b = placementOf(res.prints[1], flat)!;
    expect(b.x_mm - a.x_mm).toBeCloseTo(10);
    expect(res.key).toBe(res.prints[1].key);
  });
  it('тот же силуэт, другой вид — как «На другой вид»', () => {
    const flat = sleeves();
    const src = placedOn(flat, 'front', 'chest');
    const res = pasteLayer([], src, 'back', ctxOf(flat), null)!;
    expect(placementOf(res.prints[0], flat)!.view).toBe('back');
  });
  it('другой силуэт — переносится по зонам (remapToFlat); не нашлось зоны — null', () => {
    const from = sleeves();
    const to = { ...makeFlat({ id: 'hoodie-test' }) };
    const src = placedOn(from, 'front', 'chest');
    const res = pasteLayer([], src, 'front', ctxOf(to), from)!;
    expect(parseLayout(res.prints[0].layout)?.flat_id).toBe('hoodie-test');
    const sleeveSrc = placedOn(from, 'sleeve_left', 'sleeve-l');
    expect(pasteLayer([], sleeveSrc, 'front', ctxOf(to), from)).toBeNull();
  });
});
