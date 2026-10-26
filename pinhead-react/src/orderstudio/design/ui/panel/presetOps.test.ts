import { describe, it, expect } from 'vitest';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { flat as makeFlat, CENTER_X, NECKLINE_Y } from '../../fixtures.testutil';
import { newPlacedPrint, placementOf } from '../../model/layout';
import { SLEEVE_CENTER_X, sleevedFlat } from '../../fixtures5b.testutil';
import { whereOf } from './panelOps';
import { PRESET_WIDTH_MM, studioPresets, withStudioPreset } from './presetOps';

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };

function setup(flat = makeFlat(), view = 'front', areaId = 'chest') {
  const ctx = { flat, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts' };
  const print = newPlacedPrint(ASSET, `orders/${ORDER}/logo/a.png`, areaId, { ...ctx, view: view as never, itemKind: 'sku', method: 'dtf' });
  const pl = placementOf(print!, flat)!;
  return { pl, ...whereOf(pl, ctx)! };
}

describe('пресеты «Стандарты Pinhead» — место и размер (веха 5в, Э2)', () => {
  it('центр груди: ширина стандарта, высота по пропорции, по оси, 75 мм от горловины', () => {
    const { pl, view, area } = setup();
    const g = withStudioPreset(view, area, pl, 'chest-standard');
    expect(g.width_mm).toBeCloseTo(PRESET_WIDTH_MM['chest-standard']);
    expect(g.height_mm).toBeCloseTo(250 * 80 / 120);
    expect(g.x_mm + g.width_mm / 2).toBeCloseTo(CENTER_X);
    expect(g.y_mm).toBeCloseTo(NECKLINE_Y + 75);
  });
  it('центр зоны — размер не меняет', () => {
    const { pl, view, area } = setup();
    const g = withStudioPreset(view, area, pl, 'center-zone');
    expect([g.width_mm, g.height_mm]).toEqual([pl.width_mm, pl.height_mm]);
  });
  it('зона уже стандарта — ширина ужимается до зоны минус безопасный отступ', () => {
    const narrow = makeFlat();
    const front = narrow.views.find((v) => v.kind === 'front')!;
    front.print_areas[0] = { ...front.print_areas[0], polygon_mm: [[200, 140], [400, 140], [400, 540], [200, 540]] };
    const { pl, view, area } = setup(narrow);
    expect(withStudioPreset(view, area, pl, 'chest-standard').width_mm).toBeCloseTo(200 - 2 * area.safe_inset_mm);
  });
  it('повёрнутое на 90° — стандарт по видимой ширине (рамке)', () => {
    const { pl, view, area } = setup();
    const g = withStudioPreset(view, area, { ...pl, rotation_deg: 90 }, 'left-chest');
    expect(g.height_mm).toBeCloseTo(PRESET_WIDTH_MM['left-chest']);
    expect(g.width_mm).toBeCloseTo(90 * 120 / 80);
  });
  it('рукав: пресет рукава по оси, 70 мм; подсказки с размером', () => {
    const { pl, view, area } = setup(sleevedFlat(), 'sleeve_left', 'sleeve-l');
    expect(studioPresets(view, area).map((p) => p.key)).toEqual(['sleeve-standard', 'center-zone']);
    const g = withStudioPreset(view, area, pl, 'sleeve-standard');
    expect(g.width_mm).toBeCloseTo(70);
    expect(g.x_mm + g.width_mm / 2).toBeCloseTo(SLEEVE_CENTER_X);
    expect(studioPresets(view, area)[0].hint).toBe('70 мм по оси рукава');
    const front = setup();
    expect(studioPresets(front.view, front.area).map((p) => [p.label, p.hint])).toEqual([
      ['Центр груди', '250 мм, 75 мм от горловины'],
      ['Левая грудь', '90 мм, 60 мм от горловины'],
      ['Центр зоны', 'размер прежний'],
    ]);
  });
});
