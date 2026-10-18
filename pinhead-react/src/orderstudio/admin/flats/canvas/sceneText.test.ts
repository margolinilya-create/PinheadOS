import { describe, it, expect } from 'vitest';
import { area, backView, frontView } from '../../../design/fixtures.testutil';
import { sleeveView } from '../../../design/fixtures5b.testutil';
import { announceArea, buildScene, sceneText, type SceneInput } from './sceneText';

const FM = { w: 600, h: 760 };
const POLY = area({ id: 'yoke', name: 'Кокетка', zone_id: 'back', polygon_mm: [[200, 60], [400, 60], [380, 120], [220, 120]], safe_inset_mm: 0 });

function input(patch: Partial<SceneInput> = {}): SceneInput {
  return { view: frontView(), flatMm: FM, accessory: false, selectedAreaId: null, readOnly: false, mode: 'select', ...patch };
}

describe('сцена холста редактора', () => {
  it('стабильная строка для фикстуры флэта: зоны в мм, ручки, направляющие, режим', () => {
    const view = backView({ print_areas: [...backView().print_areas, POLY], anchors: { neckline_point: { x: 300, y: 40 }, center_axis_x: 300, axes: [{ id: 'dart', name: 'Вытачка', x: 210 }] } });
    expect(sceneText(buildScene(input({ view, selectedAreaId: 'back' })))).toBe([
      'mode=select',
      'area back «Спина» rect 150,100 300×400 safe 165,115 270×370 [selected]',
      'area label «Этикетка» rect 260,48 80×32 safe 265,53 70×22',
      'area yoke «Кокетка» poly 200,60 400,60 380,120 220,120',
      'handle axis 300,10 axis=x',
      'handle neckline 300,40 axis=xy',
      'guide axis v=300',
      'guide axes:dart v=210',
    ].join('\n'));
  });

  it('аксессуар — без горловины; ось остаётся', () => {
    const s = buildScene(input({ accessory: true }));
    expect(s.handles.map((h) => h.id)).toEqual(['axis']);
  });

  it('рукав: низ — только по Y, центр — только по X', () => {
    const s = buildScene(input({ view: sleeveView('sleeve_left', 'flats/x/v1/sleeve_left.svg') }));
    expect(s.handles.map((h) => [h.id, h.axis, h.x, h.y])).toEqual([
      ['sleeve_bottom', 'y', 150, 500],
      ['sleeve_center', 'x', 150, 60.8],
    ]);
    expect(s.guides.map((g) => `${g.id}:${g.orient}=${g.at}`)).toEqual(['sleeve_bottom:h=500', 'sleeve_center:v=150']);
  });

  it('только просмотр и калибровка — без ручек, направляющие на месте', () => {
    for (const p of [{ readOnly: true }, { mode: 'calibrate' as const }]) {
      const s = buildScene(input(p));
      expect(s.handles).toEqual([]);
      expect(s.guides.length).toBeGreaterThan(0);
    }
    expect(sceneText(buildScene(input({ readOnly: true })))).toMatch(/^mode=select readonly/);
  });

  it('нет якорей — ручки на местах по умолчанию', () => {
    const s = buildScene(input({ view: frontView({ anchors: {} }) }));
    expect(s.handles.map((h) => [h.id, h.x, h.y])).toEqual([['axis', 300, 51.2], ['neckline', 300, 91.2]]);
  });

  it('многоугольник не прямоугольник; safe не помещается — нет', () => {
    const s = buildScene(input({ view: frontView({ print_areas: [POLY] }) }));
    expect(s.areas[0]).toMatchObject({ rect: false, safe: null, box: { x: 200, y: 60, w: 200, h: 60 } });
  });

  it('пересказ зоны: имя, X, Y, размер; у многоугольника — где правится', () => {
    const [chest] = buildScene(input()).areas;
    expect(announceArea(chest)).toBe('Зона «Грудь»: X 150, Y 140, 300 × 400 мм');
    const [poly] = buildScene(input({ view: frontView({ print_areas: [POLY] }) })).areas;
    expect(announceArea(poly)).toMatch(/многоугольник — точки правятся в режиме «Точки»/);
  });
});
