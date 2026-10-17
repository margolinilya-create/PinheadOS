/**
 * Выверка зон: печатная зона лежит ВНУТРИ силуэта своего флэта (по viewBox).
 * В DM — тест над seed-файлами (`zoneFit.test.ts`); здесь — чистая функция,
 * которую сторож сида (задача 4) зовёт на каждом виде, а вкладка «Флэты и зоны»
 * (5б) — при правке зоны. Ловит «вылет зоны за изделие».
 */
import type { FlatView } from '../types';

/** Зоны вида, вылезающие за габарит флэта (мм); пусто — всё внутри */
export function areasOutsideFlat(view: Pick<FlatView, 'print_areas'>, flatMm: { w: number; h: number }): string[] {
  return view.print_areas
    .filter((a) => {
      const xs = a.polygon_mm.map((p) => p[0]);
      const ys = a.polygon_mm.map((p) => p[1]);
      return Math.min(...xs) < 0 || Math.min(...ys) < 0 || Math.max(...xs) > flatMm.w || Math.max(...ys) > flatMm.h;
    })
    .map((a) => a.id);
}
