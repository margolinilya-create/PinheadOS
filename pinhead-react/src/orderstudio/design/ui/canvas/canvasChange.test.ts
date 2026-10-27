import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import type { ZoneDefinition } from '../../../../types/catalog';
import { newSalesPrint } from '../../../model/factory';
import type { SalesPrint } from '../../../model/types';
import { area, flat, frontView } from '../../fixtures.testutil';
import { newPlacedPrint, parseLayout, placementOf, type NewPlacedCtx } from '../../model/layout';
import type { AssetMeta } from '../../types';
import { applyCanvasChange, CANVAS_LABELS, type CanvasChange } from './canvasChange';

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const FLAT = flat();
const CTX: NewPlacedCtx = { flat: FLAT, zonesCatalog: ZONES, category: 'tshirts', view: 'front', itemKind: 'sku', method: 'dtf' };
const ASSET: AssetMeta = { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };
const PATH = 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/u-logo.png';

function placed(): SalesPrint {
  return newPlacedPrint(ASSET, PATH, 'chest', CTX)!;
}

describe('applyCanvasChange', () => {
  it('place: новая геометрия → новое нанесение (мм, отступ, раскладка), прочие не тронуты', () => {
    const other = newSalesPrint({ zone: 'Спина' });
    const p = placed();
    const pl = placementOf(p, FLAT)!;
    const change: CanvasChange = { kind: 'place', key: p.key, geometry: { ...pl, x_mm: pl.x_mm + 10, width_mm: 150, height_mm: 100 }, label: CANVAS_LABELS.transform };
    const out = applyCanvasChange([other, p], change, CTX)!;
    expect(out[0]).toBe(other);
    expect(out[1]).toMatchObject({ key: p.key, width_mm: 150, height_mm: 100, offset_from: 'neck_seam' });
    expect(parseLayout(out[1].layout)?.x_mm).toBeCloseTo(pl.x_mm + 10, 1);
    expect(p.width_mm).toBe(120); // исходное не мутировано
  });

  it('place: центр рамки в другой зоне того же вида — нанесение получает её зону; вне зон и nudge — зона прежняя', () => {
    const belly = area({ id: 'belly', name: 'Живот', polygon_mm: [[150, 560], [450, 560], [450, 800], [150, 800]] });
    const twoAreas = flat({ views: [frontView({ print_areas: [area(), belly] })] });
    const ctx: NewPlacedCtx = { ...CTX, flat: twoAreas };
    const p = newPlacedPrint(ASSET, PATH, 'chest', ctx)!;
    const pl = placementOf(p, twoAreas)!;
    const moveTo = (x_mm: number, y_mm: number): CanvasChange => ({ kind: 'place', key: p.key, geometry: { ...pl, x_mm, y_mm }, label: CANVAS_LABELS.move });
    const inBelly = applyCanvasChange([p], moveTo(240, 640), ctx)!;
    expect(parseLayout(inBelly[0].layout)?.area_id).toBe('belly');
    const nowhere = applyCanvasChange([p], moveTo(10, 10), ctx)!;
    expect(parseLayout(nowhere[0].layout)?.area_id).toBe('chest');
    const nudge: CanvasChange = { kind: 'nudge', key: p.key, dx_mm: 0, dy_mm: 300, label: CANVAS_LABELS.nudge, coalesceKey: 'n' };
    expect(parseLayout(applyCanvasChange([p], nudge, ctx)![0].layout)?.area_id).toBe('chest');
  });

  it('place: центр ещё в текущей зоне — зона прежняя, даже если её перекрывает другая; недоступная модели зона не берётся', () => {
    const big = area({ id: 'big', name: 'Перед целиком', polygon_mm: [[100, 100], [500, 100], [500, 900], [100, 900]] });
    const belly = area({ id: 'belly', name: 'Живот', polygon_mm: [[150, 560], [450, 560], [450, 800], [150, 800]] });
    const overlap = flat({ views: [frontView({ print_areas: [big, area(), belly] })] });
    const ctx: NewPlacedCtx = { ...CTX, flat: overlap };
    const p = newPlacedPrint(ASSET, PATH, 'chest', ctx)!;
    const pl = placementOf(p, overlap)!;
    const moveTo = (y_mm: number, c: typeof ctx = ctx): SalesPrint => applyCanvasChange([p], { kind: 'place', key: p.key, geometry: { ...pl, y_mm }, label: CANVAS_LABELS.move }, c)![0];
    // Чуть ниже — центр всё ещё в «Груди»: не перескакивать в перекрывающий «Перед целиком»
    expect(parseLayout(moveTo(pl.y_mm + 20).layout)?.area_id).toBe('chest');
    // В «Животе» центр попал в две зоны — берётся не текущая и не первая попавшаяся, а та, что не «Грудь»: «Перед целиком» идёт первым
    expect(parseLayout(moveTo(640).layout)?.area_id).toBe('big');
    // «Перед целиком» модели недоступен — берётся «Живот»
    const onlyBelly = { ...ctx, areaAllowed: (a: { id: string }) => a.id !== 'big' };
    expect(parseLayout(moveTo(640, onlyBelly).layout)?.area_id).toBe('belly');
  });

  it('nudge: сдвиг считается от СВЕЖЕГО нанесения (две стрелки подряд до перерисовки не теряются)', () => {
    const p = placed();
    const y0 = parseLayout(p.layout)!.y_mm;
    const step: CanvasChange = { kind: 'nudge', key: p.key, dx_mm: 0, dy_mm: 1, label: CANVAS_LABELS.nudge, coalesceKey: `nudge:${p.key}` };
    const once = applyCanvasChange([p], step, CTX)!;
    const twice = applyCanvasChange(once, step, CTX)!;
    expect(parseLayout(twice[0].layout)!.y_mm).toBeCloseTo(y0 + 2, 6);
    expect(twice[0].offset_mm).toBe((p.offset_mm ?? 0) + 2);
  });

  it('unplace: «Снять с изделия» — раскладка null, строка с зоной, мм и файлом остаётся', () => {
    const p = placed();
    const out = applyCanvasChange([p], { kind: 'unplace', key: p.key, label: CANVAS_LABELS.unplace }, CTX)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: p.key, layout: null, zone: p.zone, width_mm: 120, artwork_path: PATH });
  });

  it('ничего не меняется — null (истории и записи нет)', () => {
    const p = placed();
    const pl = placementOf(p, FLAT)!;
    expect(applyCanvasChange([p], { kind: 'place', key: p.key, geometry: pl, label: CANVAS_LABELS.move }, CTX)).toBeNull();
    expect(applyCanvasChange([p], { kind: 'nudge', key: p.key, dx_mm: 0, dy_mm: 0, label: CANVAS_LABELS.nudge, coalesceKey: 'k' }, CTX)).toBeNull();
  });

  it('нанесения нет, оно не на холсте или раскладка не по форме — null', () => {
    const row = newSalesPrint({ zone: 'Грудь (перед)' });
    const p = placed();
    const pl = placementOf(p, FLAT)!;
    expect(applyCanvasChange([p], { kind: 'place', key: 'nope', geometry: pl, label: 'x' }, CTX)).toBeNull();
    expect(applyCanvasChange([row], { kind: 'unplace', key: row.key, label: 'x' }, CTX)).toBeNull();
    expect(applyCanvasChange([row], { kind: 'nudge', key: row.key, dx_mm: 1, dy_mm: 0, label: 'x', coalesceKey: 'k' }, CTX)).toBeNull();
    // шире 5 м — раскладка не проходит разбор, нанесение не трогается
    expect(applyCanvasChange([p], { kind: 'place', key: p.key, geometry: { ...pl, x_mm: 99999 }, label: 'x' }, CTX)).toBeNull();
  });
});
