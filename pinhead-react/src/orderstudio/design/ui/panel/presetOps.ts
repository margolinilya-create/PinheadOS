/**
 * «Стандарты Pinhead» (веха 5в, Э2): пресет ставит место **и** размер.
 * Отдельно от `panelOps` — тот статически в чанке холста (через `useDesignTab`),
 * а пресеты читают только ленивые панель и части сцены.
 *
 * Размеры — константы (решение владельца 26.10: правила — в коде); ширина —
 * по видимой рамке (с поворотом), высота — по пропорции нанесения; зона уже
 * стандарта — ужимается до зоны минус безопасный отступ (и по высоте тоже).
 */
import type { FlatView, PrintArea } from '../../types';
import { STANDARD_PLACEMENT, viewZone, type PositionPreset } from '../../geometry/view';
import { rotatedAabb } from '../../geometry/coords';
import type { Geometry } from '../canvas/canvasMath';
import { presetsFor, withPreset } from './panelOps';

export type StudioPreset = PositionPreset | 'sleeve-standard';

/** Ширина стандарта по видимой рамке, мм (≈ отраслевые нормы: грудь 10", левая грудь 3,5", спина 12") */
export const PRESET_WIDTH_MM = {
  'chest-standard': 250,
  'left-chest': 90,
  'back-standard': 300,
  'sleeve-standard': 70,
} as const satisfies Partial<Record<StudioPreset, number>>;

/** Лого на рукаве — от верха зоны рукава, мм */
export const SLEEVE_TOP_MM = 40;

export interface StudioPresetOption {
  key: StudioPreset;
  label: string;
  /** Что сделает пресет — подсказка у чипа */
  hint: string;
}

const isSleeve = (view: FlatView) => view.kind === 'sleeve_left' || view.kind === 'sleeve_right';

const HINTS: Record<PositionPreset, string> = {
  'center-x': 'по оси изделия',
  'center-zone': 'размер прежний',
  top: 'к верху зоны',
  bottom: 'к низу зоны',
  'chest-standard': `${PRESET_WIDTH_MM['chest-standard']} мм, ${STANDARD_PLACEMENT.chestBelowNecklineMm} мм от горловины`,
  'left-chest': `${PRESET_WIDTH_MM['left-chest']} мм, ${STANDARD_PLACEMENT.leftChestBelowNecklineMm} мм от горловины`,
  'back-standard': `${PRESET_WIDTH_MM['back-standard']} мм, ${STANDARD_PLACEMENT.backBelowNecklineMm} мм от горловины`,
};

/** Пресеты вида и зоны; у рукава с осью — свой пресет перед «Центром зоны» */
export function studioPresets(view: FlatView, area: PrintArea): StudioPresetOption[] {
  const base = presetsFor(view, area).map((p) => ({ ...p, hint: HINTS[p.key] }));
  if (!isSleeve(view) || area.zone_id === null) return base;
  return [{ key: 'sleeve-standard', label: 'Лого на рукаве', hint: `${PRESET_WIDTH_MM['sleeve-standard']} мм по оси рукава` }, ...base];
}

/** Масштаб под ширину стандарта по видимой рамке, не больше зоны минус отступ */
function scaledTo(view: FlatView, area: PrintArea, pl: Geometry, widthMm: number): Geometry {
  const { zone, safeInsetMm } = viewZone(view, undefined, area.id);
  const box = rotatedAabb({ x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm }, pl.rotation_deg);
  if (!(box.w > 0) || !(box.h > 0)) return pl;
  const maxW = Math.max(1, zone.zw - 2 * safeInsetMm);
  const maxH = Math.max(1, zone.zh - 2 * safeInsetMm);
  const k = Math.min(widthMm, maxW) / box.w;
  const fit = Math.min(k, maxH / box.h);
  return { ...pl, width_mm: pl.width_mm * fit, height_mm: pl.height_mm * fit };
}

export function withStudioPreset(view: FlatView, area: PrintArea, pl: Geometry, preset: StudioPreset): Geometry {
  const width = (PRESET_WIDTH_MM as Partial<Record<StudioPreset, number>>)[preset];
  const sized = width ? scaledTo(view, area, pl, width) : pl;
  if (preset !== 'sleeve-standard') return withPreset(view, area, sized, preset);
  const { zone } = viewZone(view, undefined, area.id);
  const axis = view.anchors.sleeve_center_x ?? zone.zx + zone.zw / 2;
  return { ...sized, x_mm: axis - sized.width_mm / 2, y_mm: zone.zy + SLEEVE_TOP_MM };
}
