import { describe, it, expect } from 'vitest';
import { newSalesPrint } from '../../../model/factory';
import { announcePrint, canvasHint, canvasLabel } from './canvasText';

describe('подписи холста', () => {
  it('aria-label называет модель и вид', () => {
    expect(canvasLabel('Футболка FreeFit', 'front')).toBe('Холст: Футболка FreeFit, вид перед');
    expect(canvasLabel('Худи', 'back')).toBe('Холст: Худи, вид спина');
    expect(canvasLabel('Худи', 'back', true)).toBe('Холст: Худи, вид спина, как на изделии');
  });

  it('подсказка: правка — клавиши; только чтение — сказано прямо, без клавиш правки', () => {
    expect(canvasHint(false)).toMatch(/Стрелки — сдвиг на 1 мм, с Shift — на 10 мм/);
    expect(canvasHint(false)).toMatch(/Delete — снять с изделия/);
    expect(canvasHint(true)).toMatch(/^Только просмотр/);
    expect(canvasHint(true)).not.toMatch(/Delete/);
  });
});

describe('announcePrint — пересказ для aria-live', () => {
  const base = newSalesPrint({ width_mm: 120, height_mm: 80 });

  it('горловина: мм от шва, выше шва — словом', () => {
    expect(announcePrint(0, { ...base, offset_mm: 80, offset_from: 'neck_seam', offset_dir: 'down' }, false))
      .toBe('Нанесение 1: 120 × 80 мм, 80 мм от шва горловины');
    expect(announcePrint(2, { ...base, offset_mm: 5, offset_from: 'neck_seam', offset_dir: 'up' }, false))
      .toBe('Нанесение 3: 120 × 80 мм, 5 мм выше шва горловины');
  });

  it('верхний край (бирка, шоппер, пояс штанов) и выход за зону', () => {
    expect(announcePrint(0, { ...base, offset_mm: 12, offset_from: 'top_edge', offset_dir: 'down' }, true))
      .toBe('Нанесение 1: 120 × 80 мм, 12 мм от верхнего края, выходит за зону');
  });

  it('без отступа и без мм — только номер и то, что известно', () => {
    expect(announcePrint(1, newSalesPrint(), false)).toBe('Нанесение 2');
  });
});
