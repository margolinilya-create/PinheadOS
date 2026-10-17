import { describe, it, expect } from 'vitest';
import { offsetFor } from './offset';
import { placementInfo } from '../geometry/view';
import { area, backView, frontView } from '../fixtures.testutil';

const front = frontView();
const box = (y: number) => ({ x: 250, y, w: 100, h: 80 });

describe('offsetFor — таблица решения 4', () => {
  it('горловина: ниже шва — down, мм целые', () => {
    const info = placementInfo(front, box(167.4), 0, undefined, 'chest');
    expect(offsetFor(info, area(), 'tshirts')).toEqual({ offset_mm: 75, offset_from: 'neck_seam', offset_dir: 'down' });
  });

  it('горловина: выше шва — up, мм по модулю', () => {
    const info = placementInfo(front, box(80), 0, undefined, 'chest');
    expect(offsetFor(info, area(), 'tshirts')).toEqual({ offset_mm: 12, offset_from: 'neck_seam', offset_dir: 'up' });
  });

  it('с поворотом меряется верх повёрнутого AABB', () => {
    const info = placementInfo(front, { x: 250, y: 200, w: 100, h: 100 }, 45, undefined, 'chest');
    // AABB 141,4 × 141,4, верх на 200 − 20,7 = 179,3 → 87 мм от горловины 92
    expect(offsetFor(info, area(), 'tshirts').offset_mm).toBe(87);
  });

  it('служебная зона (бирка, zone_id = null) — от верха зоны', () => {
    const back = backView();
    const label = back.print_areas[1];
    const info = placementInfo(back, { x: 280, y: 55, w: 40, h: 20 }, 0, undefined, 'label');
    expect(offsetFor(info, label, 'tshirts')).toEqual({ offset_mm: 7, offset_from: 'top_edge', offset_dir: 'down' });
  });

  it('штаны — от пояса (якорь горловины флэта), top_edge', () => {
    const pants = frontView({ anchors: { neckline_point: { x: 300, y: 66 }, center_axis_x: 300 } });
    const info = placementInfo(pants, box(166), 0, undefined, 'chest');
    expect(offsetFor(info, area({ zone_id: 'pants-front' }), 'pants')).toEqual({ offset_mm: 100, offset_from: 'top_edge', offset_dir: 'down' });
  });

  it('шоппер без горловины — от верха зоны', () => {
    const shopper = frontView({ anchors: { center_axis_x: 300 } });
    const info = placementInfo(shopper, box(190), 0, undefined, 'chest');
    expect(offsetFor(info, area({ zone_id: 'side-a' }), 'accessories')).toEqual({ offset_mm: 50, offset_from: 'top_edge', offset_dir: 'down' });
  });

  it('рукав (5б) — от низа рукава вверх', () => {
    const sleeve = frontView({
      kind: 'sleeve_left',
      anchors: { sleeve_bottom_y: 400, sleeve_center_x: 120 },
      print_areas: [area({ id: 'sleeve', zone_id: 'sleeve-l', polygon_mm: [[80, 90], [160, 90], [160, 420], [80, 420]], safe_inset_mm: 10 })],
    });
    const info = placementInfo(sleeve, { x: 80, y: 290, w: 80, h: 60 }, 0);
    expect(offsetFor(info, sleeve.print_areas[0], 'tshirts')).toEqual({ offset_mm: 50, offset_from: 'part_seam', offset_dir: 'up' });
  });
});
