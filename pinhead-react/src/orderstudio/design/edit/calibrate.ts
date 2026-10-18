/**
 * Калибровка вида по известному размеру (веха 5б, К11; дефект 2 DM).
 *
 * Новый масштаб = старый × k. Позиции вида в мм флэта тоже × k — якоря, оси,
 * якоря размеров и точки зон: зоны и якоря остаются на тех же точках силуэта.
 * Физические величины не меняются: безопасный отступ, лимиты печати, дельты
 * ростовки (`grade_rule` — мм на шаг размера). Калибровка — правка геометрии,
 * значит выпуск новой версии.
 */
import type { FlatView, ViewAnchors } from '../types';

const round = (v: number) => Math.round(v * 1000) / 1000;

function scaleAnchors(a: ViewAnchors, k: number): ViewAnchors {
  const out: ViewAnchors = { ...a };
  if (a.neckline_point) out.neckline_point = { x: round(a.neckline_point.x * k), y: round(a.neckline_point.y * k) };
  if (a.center_axis_x !== undefined) out.center_axis_x = round(a.center_axis_x * k);
  if (a.sleeve_bottom_y !== undefined) out.sleeve_bottom_y = round(a.sleeve_bottom_y * k);
  if (a.sleeve_center_x !== undefined) out.sleeve_center_x = round(a.sleeve_center_x * k);
  if (a.axes) out.axes = a.axes.map((ax) => ({ ...ax, x: round(ax.x * k) }));
  return out;
}

/** Умножить масштаб и все позиции вида на k; k не конечное или ≤ 0 — вид как есть */
export function calibrateView(view: FlatView, k: number): FlatView {
  if (!Number.isFinite(k) || !(k > 0) || k === 1) return view;
  const out: FlatView = {
    ...view,
    scale_mm_per_unit: view.scale_mm_per_unit * k,
    anchors: scaleAnchors(view.anchors, k),
    print_areas: view.print_areas.map((a) => ({ ...a, polygon_mm: a.polygon_mm.map(([x, y]) => [round(x * k), round(y * k)] as [number, number]) })),
  };
  if (view.size_anchors) {
    out.size_anchors = Object.fromEntries(Object.entries(view.size_anchors).map(([s, a]) => [s, scaleAnchors(a, k)]));
  }
  return out;
}

/** Масштаб по известной длине: отмерено на холсте `measuredMm`, на деле `realMm`; неверный ввод — `null` */
export function scaleFromKnownLength(scale: number, measuredMm: number, realMm: number): number | null {
  if (![scale, measuredMm, realMm].every((v) => Number.isFinite(v) && v > 0)) return null;
  return (scale * realMm) / measuredMm;
}
