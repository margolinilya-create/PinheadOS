import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { newPlacedPrint, placementOf } from '../../model/layout';
import { area, flat as makeFlat, frontView } from '../../fixtures.testutil';
import type { GarmentFlat } from '../../types';
import type { SalesPrint } from '../../../model/types';
import { copyToView } from './copyOps';
import { horizontalOffset, verticalOffset, whereOf } from './panelOps';
import { MAX_TEMPLATE_PRINTS, parseLayoutTemplate, type LayoutTemplateData } from '../../model/layoutTemplate';
import { applyTemplate, templateFromPrints } from './templateOps';

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40, size_estimated: false, has_preview: false };

const ctxOf = (flat: GarmentFlat) => ({ flat, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts' });

function placed(flat: GarmentFlat, areaId = 'chest', file = 'a.png'): SalesPrint {
  return newPlacedPrint(ASSET, `orders/${ORDER}/logo/${file}`, areaId, { ...ctxOf(flat), view: 'front', itemKind: 'sku', method: 'dtf' })!;
}

/** Позиция «грудь + спина»: грудь сдвинута и увеличена, спина — копия на вид */
function chestAndBack(flat: GarmentFlat): SalesPrint[] {
  const chest = placed(flat);
  const pl = placementOf(chest, flat)!;
  const moved = { ...chest, width_mm: 240, height_mm: 160, layout: { ...(chest.layout as object), x_mm: 190, y_mm: 172 } };
  const both = copyToView([moved], moved.key, 'back', ctxOf(flat))!.prints;
  expect(pl).toBeTruthy();
  return both.map((p, i) => (i === 1 ? { ...p, method: 'silkscreen' as const } : p));
}

/** Худи: грудь — другая зона (`hood-front`, тот же `zone_id`), горловина ниже, спины нет */
function hoodie(): GarmentFlat {
  return makeFlat({
    id: 'hoodie-test',
    views: [frontView({
      svg_path: 'flats/hoodie-test/v1/front.svg',
      anchors: { neckline_point: { x: 320, y: 130 }, center_axis_x: 320 },
      print_areas: [area({ id: 'hood-front', polygon_mm: [[170, 180], [470, 180], [470, 560], [170, 560]] })],
    })],
  });
}

describe('templateFromPrints / parseLayoutTemplate (веха 5в, Э8)', () => {
  it('снимок — вид, зона, техника, ширина и отступы; без файлов и координат; разбор возвращает то же', () => {
    const flat = makeFlat();
    const tpl = templateFromPrints(chestAndBack(flat), ctxOf(flat))!;
    expect(tpl).toMatchObject({ kind: 'layout', v: 1, flat_id: 'tshirt-test' });
    expect(tpl.prints.map((p) => [p.view, p.area_id, p.zone_id, p.method, p.width_mm])).toEqual([
      ['front', 'chest', 'front', 'dtf', 240],
      ['back', 'back', 'back', 'silkscreen', 240],
    ]);
    expect(JSON.stringify(tpl)).not.toMatch(/orders\/|"x_mm"|"y_mm"|artwork|pantone|colors|effects/);
    expect(parseLayoutTemplate(JSON.parse(JSON.stringify(tpl)))).toEqual(tpl);
  });

  it('нет размещённых — null; больше предела — обрезано до 20', () => {
    const flat = makeFlat();
    expect(templateFromPrints([], ctxOf(flat))).toBeNull();
    const many = Array.from({ length: 25 }, (_, i) => placed(flat, 'chest', `${i}.png`));
    expect(templateFromPrints(many, ctxOf(flat))!.prints).toHaveLength(MAX_TEMPLATE_PRINTS);
  });

  it.each<[string, (t: LayoutTemplateData) => unknown]>([
    ['другая версия', (t) => ({ ...t, v: 2 })],
    ['не раскладка', (t) => ({ ...t, kind: 'order' })],
    ['пусто', (t) => ({ ...t, prints: [] })],
    ['21 нанесение', (t) => ({ ...t, prints: Array.from({ length: 21 }, () => t.prints[0]) })],
  ])('битые данные (%s) — null', (_, spoil) => {
    const flat = makeFlat();
    expect(parseLayoutTemplate(spoil(templateFromPrints(chestAndBack(flat), ctxOf(flat))!))).toBeNull();
  });

  it.each([
    ['NaN ширина', { width_mm: Number.NaN }],
    ['неизвестный вид', { view: 'hood' }],
    ['неизвестная техника', { method: 'laser' }],
    ['пустая зона', { area_id: '' }],
    ['длинная зона', { area_id: 'x'.repeat(65) }],
    ['поворот 360', { rotation_deg: 360 }],
  ])('битое нанесение (%s) — null', (_, patch) => {
    const flat = makeFlat();
    const tpl = templateFromPrints(chestAndBack(flat), ctxOf(flat))!;
    expect(parseLayoutTemplate({ ...tpl, prints: [{ ...tpl.prints[0], ...patch }] })).toBeNull();
    expect(parseLayoutTemplate(null)).toBeNull();
  });
});

describe('applyTemplate', () => {
  it('тот же силуэт: новый логотип раскладывается — те же ширины и отступы; исходная строка — первая', () => {
    const flat = makeFlat();
    const ctx = ctxOf(flat);
    const src = chestAndBack(flat);
    const tpl = templateFromPrints(src, ctx)!;
    const logo = placed(flat, 'chest', 'new.png');
    const res = applyTemplate([logo], logo.key, tpl, ctx)!;
    expect(res).toMatchObject({ key: logo.key, placed: 2, skipped: { zone: 0, method: 0 } });
    expect(res.prints).toHaveLength(2);
    expect(res.prints[0].key).toBe(logo.key);
    expect(res.prints[1].key).not.toBe(logo.key);
    res.prints.forEach((p, i) => {
      const pl = placementOf(p, flat)!;
      const want = placementOf(src[i], flat)!;
      const w = whereOf(pl, ctx)!;
      const ww = whereOf(want, ctx)!;
      expect(pl.view).toBe(want.view);
      expect(p.width_mm).toBe(src[i].width_mm);
      expect(p.height_mm).toBe(src[i].height_mm);
      expect(verticalOffset(w.view, w.area, pl)).toBeCloseTo(verticalOffset(ww.view, ww.area, want), 0);
      expect(horizontalOffset(w.view, w.area, pl)).toBeCloseTo(horizontalOffset(ww.view, ww.area, want), 0);
      expect(p.artwork_path).toBe(logo.artwork_path);
      expect(p.method).toBe(src[i].method);
    });
    // Цвета и Pantone — свойства логотипа: у нового логотипа свои, раскладка их не переносит
    expect(res.prints[1]).toMatchObject({ colors: logo.colors, pantone: logo.pantone });
  });

  it('новые строки — без заметок исходного (отступ словами, комментарий)', () => {
    const flat = makeFlat();
    const ctx = ctxOf(flat);
    const tpl = templateFromPrints(chestAndBack(flat), ctx)!;
    const logo = { ...placed(flat, 'chest', 'n.png'), offset_note: 'от горловины 8 см', comment: 'по центру' };
    const res = applyTemplate([logo], logo.key, tpl, ctx)!;
    expect(res.prints[0]).toMatchObject({ offset_note: 'от горловины 8 см', comment: 'по центру' });
    expect(res.prints[1]).toMatchObject({ offset_note: '', comment: '', applied_at: null });
  });

  it('служебная зона (этикетка): на том же силуэте — по id, на чужом — пропуск', () => {
    const tee = makeFlat();
    const ctx = ctxOf(tee);
    const onLabel = { ...placed(tee), layout: { ...(placed(tee).layout as object), view: 'back', area_id: 'label', x_mm: 280, y_mm: 55 } };
    const small = { ...onLabel, width_mm: 30, height_mm: 20 };
    const tpl = templateFromPrints([small], ctx)!;
    expect(tpl.prints[0]).toMatchObject({ area_id: 'label', zone_id: null });
    const logo = placed(tee, 'chest', 'l.png');
    expect(placementOf(applyTemplate([logo], logo.key, tpl, ctx)!.prints[0], tee)!.area_id).toBe('label');
    const hood = hoodie();
    const hl = placed(hood, 'hood-front', 'h.png');
    expect(applyTemplate([hl], hl.key, { ...tpl, flat_id: 'tshirt-test' }, ctxOf(hood))).toBeNull();
  });

  it('техника, которой в зоне нет, — пропуск «method»', () => {
    const tee = makeFlat();
    const tpl = templateFromPrints(chestAndBack(tee), ctxOf(tee))!;
    const strict = makeFlat({ views: [frontView({ print_areas: [area({ methods: ['embroidery'] })] })] });
    const logo = placed(strict, 'chest', 's.png');
    expect(applyTemplate([logo], logo.key, { ...tpl, prints: [tpl.prints[0]] }, ctxOf(strict))).toBeNull();
    const mixed = applyTemplate([logo], logo.key, { ...tpl, prints: [{ ...tpl.prints[0], method: 'embroidery' }, tpl.prints[0]] }, ctxOf(strict))!;
    expect(mixed).toMatchObject({ placed: 1, skipped: { zone: 0, method: 1 } });
  });

  it('высота — по пропорции файла, а не по раскладке', () => {
    const flat = makeFlat();
    const ctx = ctxOf(flat);
    const tpl = templateFromPrints(chestAndBack(flat), ctx)!;
    const wide = newPlacedPrint({ ...ASSET, intrinsic_w_mm: 300, intrinsic_h_mm: 60 }, `orders/${ORDER}/logo/w.png`, 'chest', { ...ctx, view: 'front', itemKind: 'sku', method: 'dtf' })!;
    const res = applyTemplate([wide], wide.key, { ...tpl, prints: [tpl.prints[0]] }, ctx)!;
    expect(res.prints[0].width_mm).toBe(240);
    expect(res.prints[0].height_mm).toBe(48);
  });

  it('другой силуэт: зона по zone_id, отступ от горловины сохраняется; вида нет — пропуск', () => {
    const tee = makeFlat();
    const tpl = templateFromPrints(chestAndBack(tee), ctxOf(tee))!;
    const hood = hoodie();
    const ctx = ctxOf(hood);
    const logo = placed(hood, 'hood-front', 'h.png');
    const res = applyTemplate([logo], logo.key, tpl, ctx)!;
    expect(res).toMatchObject({ placed: 1, skipped: { zone: 1, method: 0 } });
    const pl = placementOf(res.prints[0], hood)!;
    expect(pl.area_id).toBe('hood-front');
    const w = whereOf(pl, ctx)!;
    expect(verticalOffset(w.view, w.area, pl)).toBeCloseTo(tpl.prints[0].down_mm, 0);
  });

  it('ни одного места или исходное не размещено — null; остальные нанесения позиции не тронуты', () => {
    const tee = makeFlat();
    const tpl = templateFromPrints(chestAndBack(tee), ctxOf(tee))!;
    const hood = hoodie();
    const logo = placed(hood, 'hood-front', 'h.png');
    expect(applyTemplate([logo], logo.key, { ...tpl, prints: [tpl.prints[1]] }, ctxOf(hood))).toBeNull();
    const loose = { ...logo, layout: null };
    expect(applyTemplate([loose], loose.key, tpl, ctxOf(hood))).toBeNull();
    const other = placed(tee, 'chest', 'o.png');
    const mine = placed(tee, 'chest', 'm.png');
    const res = applyTemplate([other, mine], mine.key, tpl, ctxOf(tee))!;
    expect(res.prints[0]).toBe(other);
    expect(res.prints.map((p) => p.artwork_path)).toEqual([other.artwork_path, mine.artwork_path, mine.artwork_path]);
  });
});
