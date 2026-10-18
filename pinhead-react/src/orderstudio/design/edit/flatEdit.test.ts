import { describe, it, expect } from 'vitest';
import {
  addArea, addView, areaRect, defaultAnchors, emptyFlat, insertPoint, isRectArea, moveArea, movePoint, rectArea,
  removeArea, removePoint, removeView, revertGeometry, setAnchors, setAreaPolygon, setAreaRect, setAxes, setViewFile,
  updateArea, updateMeta,
} from './flatEdit';
import { geometryChanged } from '../catalog/flatVersion';
import { parseFlatsCatalog } from '../catalog/flatsSchema';
import { area, clone, flat } from '../fixtures.testutil';

const valid = (f: ReturnType<typeof flat>) => parseFlatsCatalog({ version: 1, flats: [f] }).issues;
const MM = { w: 600, h: 800 };

describe('флэт и виды', () => {
  it('emptyFlat — версия 1, снят с подбора, путь по формуле, проходит схему', () => {
    const f = emptyFlat('polo-test', 'Поло', 'polo', 'front', { scale_mm_per_unit: 1, flatMm: MM });
    expect(f).toMatchObject({ id: 'polo-test', version: 1, active: false, typical: false });
    expect(f.views[0].svg_path).toBe('flats/polo-test/v1/front.svg');
    expect(f.views[0].print_areas[0]).toMatchObject({ zone_id: null, name: 'Перед' });
    expect(valid(f)).toEqual([]);
  });

  it('defaultAnchors: перед — горловина 12 % и ось; рукав — низ 92 % и центр; аксессуар — без горловины', () => {
    expect(defaultAnchors('front', MM, false)).toEqual({ neckline_point: { x: 300, y: 96 }, center_axis_x: 300 });
    expect(defaultAnchors('sleeve_left', MM, false)).toEqual({ sleeve_bottom_y: 736, sleeve_center_x: 300 });
    expect(defaultAnchors('back', MM, true)).toEqual({ center_axis_x: 300 });
  });

  it('addView / removeView: вид не повторяется, последний не удаляется', () => {
    const f = flat();
    const s = addView(f, 'sleeve_left', { scale_mm_per_unit: 1, flatMm: { w: 300, h: 600 } });
    expect(s.views.map((v) => v.kind)).toEqual(['front', 'back', 'sleeve_left']);
    expect(valid(s)).toEqual([]);
    expect(addView(s, 'front', { scale_mm_per_unit: 1, flatMm: MM })).toBe(s);
    const one = removeView(removeView(s, 'back'), 'sleeve_left');
    expect(one.views.map((v) => v.kind)).toEqual(['front']);
    expect(removeView(one, 'front')).toBe(one);
    expect(f.views).toHaveLength(2);
  });

  it('setViewFile меняет масштаб; масштаб ≤ 0 — отказ', () => {
    const f = flat();
    expect(setViewFile(f, 'front', { scale_mm_per_unit: 0.5 }).views[0].scale_mm_per_unit).toBe(0.5);
    expect(setViewFile(f, 'front', { scale_mm_per_unit: 0 })).toBe(f);
  });

  it('setAnchors сливает и убирает undefined; setAxes — оси и их снятие', () => {
    const f = setAnchors(flat(), 'front', { center_axis_x: 310, neckline_point: undefined });
    expect(f.views[0].anchors).toEqual({ center_axis_x: 310 });
    const ax = setAxes(flat(), 'front', [{ id: 'dart', name: 'Вытачка', x: 200 }]);
    expect(ax.views[0].anchors.axes).toEqual([{ id: 'dart', name: 'Вытачка', x: 200 }]);
    expect(valid(ax)).toEqual([]);
    expect('axes' in setAxes(ax, 'front', []).views[0].anchors).toBe(false);
  });
});

describe('зоны', () => {
  it('rectArea ↔ areaRect; isRectArea', () => {
    const a = rectArea('chest', 'Грудь', 'front', { x: 10, y: 20, w: 100, h: 50 }, 5);
    expect(areaRect(a)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(isRectArea(a)).toBe(true);
    expect(isRectArea({ polygon_mm: [[0, 0], [10, 0], [12, 10], [0, 10]] })).toBe(false);
    expect(isRectArea({ polygon_mm: [[0, 0], [10, 0], [10, 10]] })).toBe(false);
    expect(isRectArea({ polygon_mm: [[0, 0], [10, 0], [10, 10], [0, 0]] })).toBe(false);
  });

  it('addArea / removeArea: id не повторяется, последняя зона не удаляется', () => {
    const f = flat();
    const two = addArea(f, 'front', area({ id: 'pocket', name: 'Карман', zone_id: 'pocket' }));
    expect(two.views[0].print_areas.map((a) => a.id)).toEqual(['chest', 'pocket']);
    expect(addArea(two, 'front', area({ id: 'pocket' }))).toBe(two);
    const one = removeArea(two, 'front', 'chest');
    expect(one.views[0].print_areas.map((a) => a.id)).toEqual(['pocket']);
    expect(removeArea(one, 'front', 'pocket')).toBe(one);
  });

  it('moveArea двигает; на краях — отказ', () => {
    const f = addArea(flat(), 'front', area({ id: 'pocket' }));
    expect(moveArea(f, 'front', 'pocket', -1).views[0].print_areas.map((a) => a.id)).toEqual(['pocket', 'chest']);
    expect(moveArea(f, 'front', 'chest', -1)).toBe(f);
    expect(moveArea(f, 'front', 'pocket', 1)).toBe(f);
  });

  it('updateArea: id неизменен; default_method вне methods сбрасывается', () => {
    const f = updateArea(flat(), 'front', 'chest', { id: 'other', default_method: 'dtg', methods: ['dtf', 'dtg'] });
    expect(f.views[0].print_areas[0]).toMatchObject({ id: 'chest', default_method: 'dtg' });
    const g = updateArea(f, 'front', 'chest', { methods: ['dtf'] });
    expect(g.views[0].print_areas[0].default_method).toBeUndefined();
    expect(valid(g)).toEqual([]);
    expect(updateArea(f, 'front', 'nope', { name: 'x' })).toBe(f);
  });

  it('setAreaRect — прямоугольник; нулевая сторона — отказ', () => {
    const f = flat();
    expect(areaRect(setAreaRect(f, 'front', 'chest', { x: 1, y: 2, w: 3, h: 4 }).views[0].print_areas[0])).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(setAreaRect(f, 'front', 'chest', { x: 1, y: 2, w: 0, h: 4 })).toBe(f);
  });

  it('многоугольник: 3…256 точек, вставка посередине ребра, удаление не ниже трёх', () => {
    const f = flat();
    const tri = setAreaPolygon(f, 'front', 'chest', [[150, 140], [450, 140], [300, 540]]);
    expect(tri.views[0].print_areas[0].polygon_mm).toHaveLength(3);
    expect(setAreaPolygon(f, 'front', 'chest', [[0, 0], [1, 1]])).toBe(f);
    expect(setAreaPolygon(f, 'front', 'chest', Array.from({ length: 257 }, (_, i) => [i, i % 2] as [number, number]))).toBe(f);
    expect(removePoint(tri, 'front', 'chest', 0)).toBe(tri);
    const four = insertPoint(tri, 'front', 'chest', 0);
    expect(four.views[0].print_areas[0].polygon_mm[1]).toEqual([300, 140]);
    expect(removePoint(four, 'front', 'chest', 1).views[0].print_areas[0].polygon_mm).toEqual(tri.views[0].print_areas[0].polygon_mm);
    expect(movePoint(tri, 'front', 'chest', 2, [310, 530]).views[0].print_areas[0].polygon_mm[2]).toEqual([310, 530]);
    expect(movePoint(tri, 'front', 'chest', 9, [0, 0])).toBe(tri);
    const full = setAreaPolygon(f, 'front', 'chest', Array.from({ length: 256 }, (_, i) => [i, i % 2 ? 0 : 100] as [number, number]));
    expect(insertPoint(full, 'front', 'chest', 0)).toBe(full);
  });
});

describe('метаданные и отмена правок силуэта', () => {
  it('updateMeta меняет только разрешённые поля', () => {
    const f = flat();
    const m = updateMeta(f, { name: 'Новое', active: false, version: 9 } as never);
    expect(m).toMatchObject({ name: 'Новое', active: false, version: 1 });
    expect(updateMeta(f, {})).toBe(f);
  });

  it('revertGeometry: геометрия базы, метаданные черновика; после — geometryChanged = false', () => {
    const base = flat();
    let draft = setAreaRect(base, 'front', 'chest', { x: 100, y: 100, w: 200, h: 200 });
    draft = updateArea(draft, 'front', 'chest', { tz_row: 'front_l', name: 'Грудь слева' });
    draft = addArea(draft, 'front', area({ id: 'new' }));
    draft = updateMeta(draft, { name: 'Новое имя', sku_codes: ['T-006'] });
    expect(geometryChanged(base, draft, [])).toBe(true);
    const out = revertGeometry(base, draft);
    expect(geometryChanged(base, out, [])).toBe(false);
    expect(out).toMatchObject({ name: 'Новое имя', sku_codes: ['T-006'] });
    expect(out.views[0].print_areas).toHaveLength(1);
    expect(out.views[0].print_areas[0]).toMatchObject({ tz_row: 'front_l', name: 'Грудь слева', polygon_mm: base.views[0].print_areas[0].polygon_mm });
    expect(clone(base)).toEqual(flat());
  });
});
