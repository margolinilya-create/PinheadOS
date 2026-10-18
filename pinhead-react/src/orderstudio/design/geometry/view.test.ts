// Перенос DM `geometry.test.ts` (мультизона, пресеты, отступ, оси) на `FlatView`.
import { describe, it, expect } from 'vitest';
import type { Bbox } from './coords';
import {
  placementInfo, anchorsForSize, viewZone, findPrintArea, presetPosition,
  fitToZone, yForNecklineOffset, positionOnAxis, viewHasZone,
} from './view';
import { area, frontView } from '../fixtures.testutil';
import type { FlatView } from '../types';

const label = area({
  id: 'label', name: 'Этикетка', zone_id: null,
  polygon_mm: [[260, 90], [340, 90], [340, 120], [260, 120]], safe_inset_mm: 5,
});
const v: FlatView = frontView({ print_areas: [area(), label] });

describe('мультизона + пресеты позиции', () => {
  it('findPrintArea выбирает зону по id, иначе первую', () => {
    expect(findPrintArea(v, 'label').id).toBe('label');
    expect(findPrintArea(v, 'нет').id).toBe('chest');
    expect(findPrintArea(v).id).toBe('chest');
  });

  it('viewHasZone знает только свои зоны', () => {
    expect(viewHasZone(v, 'chest')).toBe(true);
    expect(viewHasZone(v, 'back')).toBe(false);
  });

  it('viewZone по areaId даёт нужную зону', () => {
    expect(viewZone(v, undefined, 'label').zone.zw).toBe(80);
    expect(viewZone(v, undefined, 'chest').zone.zw).toBe(300);
  });

  it('center-x центрирует по оси изделия, y не трогает', () => {
    expect(presetPosition(v, { x: 0, y: 200, w: 100, h: 80 }, 'center-x')).toEqual({ x_mm: 250, y_mm: 200 });
  });

  it('top прижимает к верху зоны с safe-inset', () => {
    expect(presetPosition(v, { x: 200, y: 300, w: 100, h: 80 }, 'top', undefined, 'chest').y_mm).toBe(155);
  });

  it('bottom прижимает к низу зоны с safe-inset', () => {
    expect(presetPosition(v, { x: 200, y: 300, w: 100, h: 80 }, 'bottom', undefined, 'chest').y_mm).toBe(445);
  });

  it('center-zone центрирует в зоне (этикетка)', () => {
    expect(presetPosition(v, { x: 0, y: 0, w: 40, h: 20 }, 'center-zone', undefined, 'label')).toEqual({ x_mm: 280, y_mm: 95 });
  });

  it('chest-standard: центр по оси, верх 75 мм ниже горловины', () => {
    expect(presetPosition(v, { x: 0, y: 0, w: 120, h: 100 }, 'chest-standard', undefined, 'chest')).toEqual({ x_mm: 240, y_mm: 167 });
  });

  it('left-chest: 89 мм от центра, верх 60 мм ниже горловины', () => {
    expect(presetPosition(v, { x: 0, y: 0, w: 80, h: 80 }, 'left-chest', undefined, 'chest')).toEqual({ x_mm: 349, y_mm: 152 });
  });

  it('back-standard: центр спины, 75 мм ниже горловины спинки', () => {
    const back = frontView({ kind: 'back', anchors: { neckline_point: { x: 300, y: 40 }, center_axis_x: 300 } });
    expect(presetPosition(back, { x: 0, y: 0, w: 200, h: 100 }, 'back-standard')).toEqual({ x_mm: 200, y_mm: 115 });
  });

  it('fit вписывает в зону с safe-inset, сохраняя пропорции', () => {
    const r = fitToZone(v, { x: 0, y: 0, w: 50, h: 50 }, 'fit', undefined, 'chest');
    expect(r).toEqual({ width_mm: 270, height_mm: 270, x_mm: 165, y_mm: 205 });
  });

  it('fill покрывает зону по большей стороне', () => {
    const r = fitToZone(v, { x: 0, y: 0, w: 50, h: 50 }, 'fill', undefined, 'chest');
    expect(r.width_mm).toBe(370);
    expect(r.height_mm).toBe(370);
  });
});

describe('yForNecklineOffset — обратная к verticalFromNeckline', () => {
  const roundTrip = (rot: number, offset: number) => {
    const bbox: Bbox = { x: 240, y: 300, w: 120, h: 100 };
    const y = yForNecklineOffset(v, bbox, rot, offset, undefined, 'chest');
    return placementInfo(v, { ...bbox, y }, rot, undefined, 'chest').anchor.vertical;
  };

  it('без поворота', () => expect(roundTrip(0, 75)).toBeCloseTo(75, 6));
  it('при повороте 30°', () => expect(roundTrip(30, 75)).toBeCloseTo(75, 6));
  it('отрицательный отступ — выше шва', () => expect(roundTrip(0, -20)).toBeCloseTo(-20, 6));

  it('без якоря горловины — от верха зоны', () => {
    const noNeck = frontView({ anchors: { center_axis_x: 300 } });
    expect(yForNecklineOffset(noNeck, { x: 240, y: 300, w: 120, h: 100 }, 0, 30, undefined, 'chest')).toBeCloseTo(170, 6);
  });
});

describe('positionOnAxis и якоря по размеру', () => {
  const withAxes = frontView({
    anchors: { neckline_point: { x: 300, y: 92 }, center_axis_x: 300, axes: [{ id: 'dart-l', name: 'выточка Л', x: 220 }] },
    size_anchors: { L: { neckline_point: { x: 300, y: 95 }, center_axis_x: 300 } },
  });

  it('центрирует по X оси, Y не трогает', () => {
    expect(positionOnAxis(withAxes, { x: 0, y: 250, w: 100, h: 80 }, 'dart-l')).toEqual({ x_mm: 170, y_mm: 250 });
  });

  it('неизвестная ось → null', () => {
    expect(positionOnAxis(withAxes, { x: 0, y: 0, w: 10, h: 10 }, 'нет')).toBeNull();
  });

  it('якоря размера заменяют базовые целиком; нет размера — базовые', () => {
    expect(anchorsForSize(withAxes, 'M')).toBe(withAxes.anchors);
    expect(anchorsForSize(withAxes).axes?.length).toBe(1);
    expect(anchorsForSize(withAxes, 'L').axes).toBeUndefined();
    expect(anchorsForSize(withAxes, 'L').neckline_point?.y).toBe(95);
  });
});

describe('placementInfo — опоры', () => {
  it('одежда: отсчёт от горловины', () => {
    const info = placementInfo(v, { x: 225, y: 150, w: 150, h: 200 }, 0);
    expect(info.anchor).toEqual({ kind: 'neckline', vertical: 58, horizontal: 0 });
  });

  it('шоппер без горловины: панель — от верха зоны и от оси', () => {
    const shopper = frontView({
      anchors: { center_axis_x: 190 },
      print_areas: [area({ id: 'front', polygon_mm: [[100, 200], [300, 200], [300, 500], [100, 500]], safe_inset_mm: 20 })],
    });
    const info = placementInfo(shopper, { x: 150, y: 260, w: 100, h: 80 }, 0);
    expect(info.anchor).toEqual({ kind: 'panel', vertical: 60, horizontal: 10 });
  });

  it('без оси — горизонталь от центра зоны', () => {
    const noAxis = frontView({
      anchors: {},
      print_areas: [area({ polygon_mm: [[100, 200], [300, 200], [300, 500], [100, 500]] })],
    });
    expect(placementInfo(noAxis, { x: 150, y: 260, w: 100, h: 80 }, 0).anchor.horizontal).toBe(0);
  });

  it('рукав: отсчёт от низа рукава', () => {
    const sleeve = frontView({
      kind: 'sleeve_left',
      anchors: { sleeve_bottom_y: 400, sleeve_center_x: 120 },
      print_areas: [area({ id: 'sleeve', polygon_mm: [[80, 90], [160, 90], [160, 420], [80, 420]], safe_inset_mm: 10 })],
    });
    expect(placementInfo(sleeve, { x: 80, y: 290, w: 80, h: 60 }, 0).anchor).toEqual({ kind: 'sleeve', vertical: 50, horizontal: 0 });
  });
});
