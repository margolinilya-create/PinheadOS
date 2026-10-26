/**
 * Раскладка по версии позиции и рукава (веха 5б, задача 5; К15, Review Focus 1).
 */
import { describe, it, expect } from 'vitest';
import { applyPlacement, newPlacedPrint, parseLayout, placementOf, remapToFlat, type PlaceCtx } from './layout';
import { placeArtwork } from './placeArtwork';
import { applyCanvasChange } from '../ui/canvas/canvasChange';
import { flatAtVersion } from '../catalog/flatVersion';
import { newSalesPrint } from '../../model/factory';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import type { SalesPrint } from '../../model/types';
import type { AssetMeta, GarmentFlat, PrintLayoutV1 } from '../types';
import { SLEEVE_BOTTOM_Y, SLEEVE_CENTER_X, sleevedFlat, versionedFlat } from '../fixtures5b.testutil';

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const ASSET: AssetMeta = {
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40,
  px_w: 709, px_h: 472, dpi: 300, size_estimated: false, has_preview: false,
};
const PATH = 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/u-logo.png';
const ctxOf = (flat: GarmentFlat): PlaceCtx => ({ flat, zonesCatalog: ZONES, category: 'tshirts' });
const layoutOf = (p: SalesPrint) => p.layout as unknown as PrintLayoutV1;

const FLAT = versionedFlat();
const V1 = flatAtVersion(FLAT, 1)!;

/** Нанесение, поставленное на v1 (до выпуска v2) */
function placedOnV1(areaId: string, view: 'front' | 'sleeve_left' = 'front'): SalesPrint {
  return newPlacedPrint(ASSET, PATH, areaId, { ...ctxOf(V1), view, itemKind: 'sku', method: 'dtf' })!;
}

describe('parseLayout — виды рукавов (5б)', () => {
  const base = layoutOf(placedOnV1('chest'));
  it.each(['sleeve_left', 'sleeve_right'])('%s разбирается', (view) => {
    expect(parseLayout({ ...base, view })).toMatchObject({ view });
  });
  it('неизвестный вид — null', () => {
    expect(parseLayout({ ...base, view: 'sleeve' })).toBeNull();
    expect(parseLayout({ ...base, view: 'collar' })).toBeNull();
  });
});

describe('placementOf — геометрия по версии раскладки', () => {
  it('v1 с карманом → выпущена v2 без кармана → размещение по v1, stale', () => {
    const pocket = placedOnV1('pocket');
    expect(layoutOf(pocket).flat_version).toBe(1);
    expect(placementOf(pocket, FLAT)).toMatchObject({ area_id: 'pocket', stale: true });
  });

  it('на флэте своей версии (flatAtVersion) — не stale', () => {
    expect(placementOf(placedOnV1('chest'), V1)).toMatchObject({ area_id: 'chest', stale: false });
  });

  it('версии нет в истории — текущая геометрия, stale (как в 5а)', () => {
    const p = placedOnV1('chest');
    const odd = { ...p, layout: { ...layoutOf(p), flat_version: 7 } };
    expect(placementOf(odd, FLAT)).toMatchObject({ area_id: 'chest', stale: true });
    expect(placementOf({ ...p, layout: { ...layoutOf(p), flat_version: 7 } }, flatAtVersion(FLAT, 1)!)).toMatchObject({ stale: true });
  });
});

describe('PlaceCtx — разрешённый флэт версии позиции (К15)', () => {
  it('перетаскивание нанесения на позиции v1 (после выпуска v2) оставляет flat_version: 1', () => {
    const p = placedOnV1('chest');
    const pl = placementOf(p, V1)!;
    const out = applyCanvasChange([p], { kind: 'place', key: p.key, label: '', geometry: { ...pl, x_mm: pl.x_mm + 10 } }, ctxOf(V1))!;
    expect(layoutOf(out[0])).toMatchObject({ flat_version: 1, x_mm: pl.x_mm + 10 });
  });

  it('новое размещение на позиции v1 — flat_version: 1, координаты v1', () => {
    const res = placeArtwork([placedOnV1('chest')], ASSET, PATH, 'pocket', { ...ctxOf(V1), view: 'front', itemKind: 'sku', method: 'dtf' })!;
    const added = res.prints.find((x) => x.key === res.key)!;
    expect(layoutOf(added)).toMatchObject({ flat_version: 1, area_id: 'pocket' });
  });

  it('applyPlacement пишет версию флэта контекста', () => {
    const p = placedOnV1('chest');
    expect(layoutOf(applyPlacement(p, placementOf(p, V1)!, ctxOf(FLAT))).flat_version).toBe(2);
  });
});

describe('remapToFlat — перенос на версию M и рукава', () => {
  it('перенос v1 → v2 того же флэта: та же зона по id, отступ от горловины сохранён', () => {
    const p = placedOnV1('chest');
    const before = placementOf(p, V1)!;
    const r = remapToFlat([p], FLAT, ctxOf(FLAT));
    expect(r.moved).toEqual([p.key]);
    const after = placementOf(r.prints[0], FLAT)!;
    expect(after).toMatchObject({ area_id: 'chest', stale: false });
    // горловина v1 — 92, v2 — 112: рамка сдвинулась вместе с горловиной
    expect(after.y_mm - before.y_mm).toBeCloseTo(20, 5);
    expect(layoutOf(r.prints[0]).flat_version).toBe(2);
  });

  it('карман пропал в v2 — снят с холста, строка осталась', () => {
    const p = placedOnV1('pocket');
    const r = remapToFlat([p], FLAT, ctxOf(FLAT));
    expect(r.dropped).toEqual([p.key]);
    expect(r.prints[0]).toMatchObject({ layout: null, zone: 'Карман' });
  });

  it('служебная зона той же модели переносится по id (новая версия), на чужую — нет', () => {
    const lbl = newPlacedPrint(ASSET, PATH, 'label', { ...ctxOf(V1), view: 'back', itemKind: 'sku', method: 'dtf' })!;
    expect(remapToFlat([lbl], FLAT, ctxOf(FLAT)).moved).toEqual([lbl.key]);
    expect(remapToFlat([lbl], FLAT, ctxOf({ ...FLAT, id: 'tshirt-other', history: undefined })).dropped).toEqual([lbl.key]);
  });

  it('рукав: расстояние от низа рукава и от оси рукава сохраняются', () => {
    const p = placedOnV1('sleeve-l', 'sleeve_left');
    const from = placementOf(p, V1)!;
    const fromBottom = SLEEVE_BOTTOM_Y - (from.y_mm + from.height_mm);
    const fromAxis = from.x_mm + from.width_mm / 2 - SLEEVE_CENTER_X;
    const r = remapToFlat([p], FLAT, ctxOf(FLAT));
    const to = placementOf(r.prints[0], FLAT)!;
    expect(520 - (to.y_mm + to.height_mm)).toBeCloseTo(fromBottom, 5);
    expect(to.x_mm + to.width_mm / 2 - 160).toBeCloseTo(fromAxis, 5);
  });
});

describe('рукав на холсте', () => {
  const sleeved = sleevedFlat();
  it('раскладка рукава: зона, отступ от низа рукава вверх (part_seam/up)', () => {
    const p = newPlacedPrint(ASSET, PATH, 'sleeve-r', { ...ctxOf(sleeved), view: 'sleeve_right', itemKind: 'sku', method: 'dtf' })!;
    expect(layoutOf(p)).toMatchObject({ view: 'sleeve_right', area_id: 'sleeve-r' });
    expect(p).toMatchObject({ zone: 'Правый рукав', offset_from: 'part_seam', offset_dir: 'up' });
    expect(placementOf(p, sleeved)).toMatchObject({ view: 'sleeve_right' });
  });
});

describe('placeArtwork — «не размещено» по флэту, а не по видимости', () => {
  it('нанесение со старой версии, чья зона пропала, не принимает чужой логотип', () => {
    // Раскладка версии, которой у флэта нет, на зоне, которой нет: холст её не показывает
    const chest = placedOnV1('chest');
    const lost = { ...chest, layout: { ...layoutOf(chest), flat_version: 9, area_id: 'gone' } };
    expect(placementOf(lost, FLAT)).toBeNull();
    const res = placeArtwork([lost], ASSET, PATH, 'chest', { ...ctxOf(FLAT), view: 'front', itemKind: 'sku', method: 'dtf' })!;
    expect(res.prints).toHaveLength(2);
    expect(res.prints[0]).toBe(lost);
  });

  it('строка без раскладки той же зоны по-прежнему дописывается', () => {
    const row = newSalesPrint({ zone: 'Грудь (перед)' });
    const res = placeArtwork([row], ASSET, PATH, 'chest', { ...ctxOf(FLAT), view: 'front', itemKind: 'sku', method: 'dtf' })!;
    expect(res.prints).toHaveLength(1);
    expect(res.key).toBe(row.key);
  });
});
