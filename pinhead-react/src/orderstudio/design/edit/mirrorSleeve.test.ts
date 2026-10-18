import { describe, it, expect } from 'vitest';
import { mirrorSleeveView, mirrorSvg } from './mirrorSleeve';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { parseFlatsCatalog } from '../catalog/flatsSchema';
import { area, flat, frontView } from '../fixtures.testutil';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { FlatView, GarmentFlat } from '../types';
import EVIL from './fixtures/flat-evil.svg?raw';

const SEED = import.meta.glob('../seed/flats/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const W = 400;
function sleeveFlat(patch: Partial<FlatView> = {}): GarmentFlat {
  const sleeve: FlatView = {
    kind: 'sleeve_left',
    svg_path: 'flats/tshirt-test/v1/sleeve_left.svg',
    scale_mm_per_unit: 1,
    anchors: { sleeve_bottom_y: 280, sleeve_center_x: 100, axes: [{ id: 'seam', name: 'Шов', x: 60 }] },
    size_anchors: { L: { sleeve_bottom_y: 290, sleeve_center_x: 110 } },
    grade_rule: { sleeve_bottom_dy: 4, sleeve_center_dx: 3, neckline: { dx: 1, dy: 2 } },
    print_areas: [area({ id: 'sleeve', name: 'Левый рукав', zone_id: 'sleeve-l', tz_row: 'sleeve_l', methods: ['embroidery'], polygon_mm: [[40, 60], [160, 60], [160, 150], [40, 150]], safe_inset_mm: 10 })],
    ...patch,
  };
  return flat({ sizes: ['M', 'L'], views: [frontView(), sleeve] });
}

describe('mirrorSleeveView (К10; DM — 5 тестов с адаптацией)', () => {
  it('вид меняется, X якорей, осей и зон отражён, Y прежний', () => {
    const f = mirrorSleeveView(sleeveFlat(), 'sleeve_left', W, ZONES_CATALOG_DEFAULT);
    const m = f.views[2];
    expect(m.kind).toBe('sleeve_right');
    expect(m.svg_path).toBe('flats/tshirt-test/v1/sleeve_right.svg');
    expect(m.anchors).toEqual({ sleeve_bottom_y: 280, sleeve_center_x: W - 100, axes: [{ id: 'seam', name: 'Шов', x: W - 60 }] });
    const xs = m.print_areas[0].polygon_mm.map((p) => p[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([W - 160, W - 40]);
    expect(Math.min(...m.print_areas[0].polygon_mm.map((p) => p[1]))).toBe(60);
  });

  it('якоря размеров отражены, x-дельты ростовки сменили знак, техники остались', () => {
    const m = mirrorSleeveView(sleeveFlat(), 'sleeve_left', W, ZONES_CATALOG_DEFAULT).views[2];
    expect(m.size_anchors?.L.sleeve_center_x).toBe(W - 110);
    expect(m.grade_rule).toEqual({ sleeve_bottom_dy: 4, sleeve_center_dx: -3, neckline: { dx: -1, dy: 2 } });
    expect(m.print_areas[0].methods).toEqual(['embroidery']);
  });

  it('id зон прежние; дважды — исходные числа; результат проходит схему', () => {
    const f = mirrorSleeveView(sleeveFlat(), 'sleeve_left', W, ZONES_CATALOG_DEFAULT);
    expect(f.views[2].print_areas[0].id).toBe('sleeve');
    expect(parseFlatsCatalog({ version: 1, flats: [f] }).issues).toEqual([]);
    const back = mirrorSleeveView(f, 'sleeve_right', W, ZONES_CATALOG_DEFAULT, { replace: true });
    expect(back.views[1]).toEqual(sleeveFlat().views[1]);
  });

  it('не рукав, нет вида, ширина 0 или не конечная — отказ', () => {
    const f = sleeveFlat();
    expect(mirrorSleeveView(f, 'sleeve_right', W, [])).toBe(f);
    expect(mirrorSleeveView(f, 'sleeve_left', 0, [])).toBe(f);
    expect(mirrorSleeveView(f, 'sleeve_left', Infinity, [])).toBe(f);
  });

  it('ширина — viewBox × масштаб в мм, а не naturalWidth (дефект 1 DM)', () => {
    const vb = { w: 800 };
    const scale = 0.5;
    const f = mirrorSleeveView(sleeveFlat({ scale_mm_per_unit: scale }), 'sleeve_left', vb.w * scale, ZONES_CATALOG_DEFAULT);
    const xs = f.views[2].print_areas[0].polygon_mm.map((p) => p[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([240, 360]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(vb.w * scale);
  });

  it('zone_id, tz_row и имя зоны меняются на противоположные', () => {
    const a = mirrorSleeveView(sleeveFlat(), 'sleeve_left', W, ZONES_CATALOG_DEFAULT).views[2].print_areas[0];
    expect(a).toMatchObject({ zone_id: 'sleeve-r', tz_row: 'sleeve_r', name: 'Правый рукав' });
    const own = sleeveFlat({ print_areas: [area({ id: 'sleeve', name: 'Шеврон', zone_id: 'sleeve-l', polygon_mm: [[40, 60], [160, 60], [160, 150], [40, 150]] })] });
    expect(mirrorSleeveView(own, 'sleeve_left', W, ZONES_CATALOG_DEFAULT).views[2].print_areas[0].name).toBe('Шеврон');
  });

  it('целевой вид уже есть — без подтверждения отказ, с подтверждением замена', () => {
    const f = mirrorSleeveView(sleeveFlat(), 'sleeve_left', W, ZONES_CATALOG_DEFAULT);
    expect(mirrorSleeveView(f, 'sleeve_left', W, ZONES_CATALOG_DEFAULT)).toBe(f);
    const moved = { ...f, views: f.views.map((v) => (v.kind === 'sleeve_left' ? { ...v, anchors: { ...v.anchors, sleeve_center_x: 120 } } : v)) };
    const r = mirrorSleeveView(moved, 'sleeve_left', W, ZONES_CATALOG_DEFAULT, { replace: true });
    expect(r.views).toHaveLength(3);
    expect(r.views[2].anchors.sleeve_center_x).toBe(W - 120);
  });
});

const SLEEVE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 300 600" width="300mm" height="600mm"><g id="garment" fill="#d9d9d9"><path d="M 20,0 L 280,0 L 300,600 L 10,600 Z"/></g></svg>';

describe('mirrorSvg — отражённый файл', () => {
  it('содержимое в матрице отражения со сдвигом 2·vb.x + vb.w; garment на месте; санитайзер без вырезанного', () => {
    const out = mirrorSvg(SLEEVE_SVG)!;
    expect(out).toContain('transform="matrix(-1 0 0 1 320 0)"');
    expect(out).toContain('id="garment"');
    const again = sanitizeSvg(out);
    expect(again.ok && again.removed).toEqual([]);
  });

  it.each(['0 0 1e400 10', 'NaN 0 10 10', '0 0 -5 10', '0 0 10 0', '0 0 10'])('viewBox «%s» — null', (vb) => {
    expect(mirrorSvg(SLEEVE_SVG.replace('10 0 300 600', vb))).toBeNull();
  });

  it('нет viewBox или garment — null; в выходе нет NaN/Infinity', () => {
    expect(mirrorSvg(SLEEVE_SVG.replace(/ viewBox="[^"]*"/, ''))).toBeNull();
    expect(mirrorSvg(SLEEVE_SVG.replace('id="garment"', 'id="body"'))).toBeNull();
    expect(mirrorSvg(SLEEVE_SVG)).not.toMatch(/NaN|Infinity/);
  });

  it('злонамеренный SVG: после зеркала нет скриптов, событий и внешних ссылок', () => {
    const out = mirrorSvg(EVIL)!;
    expect(out).toContain('id="garment"');
    expect(out).not.toMatch(/script|onload|onclick|onmouseover|evil\.example|javascript:|foreignObject|<image/i);
  });
});

describe('идемпотентность санитайзера (К3: сверка содержимого при повторе)', () => {
  const idem = (x: string) => {
    const once = sanitizeSvg(x);
    if (!once.ok) throw new Error(once.error);
    const twice = sanitizeSvg(once.svg);
    return twice.ok && twice.svg === once.svg;
  };

  it('все 67 SVG сида', () => {
    const files = Object.entries(SEED);
    expect(files).toHaveLength(67);
    for (const [name, text] of files) expect(idem(text), name).toBe(true);
  });

  it('выход mirrorSvg на сиде и злонамеренная фикстура', () => {
    expect(idem(EVIL)).toBe(true);
    for (const text of Object.values(SEED).slice(0, 10)) expect(idem(mirrorSvg(text)!)).toBe(true);
  });
});
