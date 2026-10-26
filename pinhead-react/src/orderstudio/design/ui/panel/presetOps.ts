/**
 * «Стандарты Pinhead» (веха 5в, Э2): пресет ставит место **и** размер.
 * Отдельно от `panelOps` — тот статически в чанке холста (через `useDesignTab`),
 * а пресеты читают только ленивые панель и части сцены.
 *
 * Размеры — константы (решение владельца 26.10: правила — в коде); ширина —
 * по видимой рамке (с поворотом), высота — по пропорции нанесения; зона уже
 * стандарта — ужимается до зоны минус безопасный отступ (и по высоте тоже);
 * место прижимается внутрь зоны. Пределы техники (B3) не ужимают: стандарты
 * меньше любой рамки техники, а выход сообщают проверки.
 */
import type { FlatView, PrintArea } from '../../types';
import { STANDARD_PLACEMENT, viewZone, type PositionPreset } from '../../geometry/view';
import { rotatedAabb } from '../../geometry/coords';
import type { Geometry } from '../canvas/canvasMath';
import { presetsFor, withHorizontalOffset, withPreset, withVerticalOffset } from './panelOps';

export type StudioPreset = PositionPreset | 'sleeve-standard';

/** Ширина стандарта по видимой рамке, мм (≈ отраслевые нормы: грудь 10", левая грудь 3,5", спина 12") */
export const PRESET_WIDTH_MM = {
  'chest-standard': 250,
  'left-chest': 90,
  'back-standard': 300,
  'sleeve-standard': 70,
} as const satisfies Partial<Record<StudioPreset, number>>;

/** Стандарты от горловины: верх рамки ниже горловины и смещение центра от оси (+ вправо на рисунке) */
const FROM_NECKLINE: Partial<Record<StudioPreset, { down: number; dx: number }>> = {
  'chest-standard': { down: STANDARD_PLACEMENT.chestBelowNecklineMm, dx: 0 },
  // Левая грудь владельца изделия — справа на рисунке переда
  'left-chest': { down: STANDARD_PLACEMENT.leftChestBelowNecklineMm, dx: STANDARD_PLACEMENT.leftChestFromCenterMm },
  'back-standard': { down: STANDARD_PLACEMENT.backBelowNecklineMm, dx: 0 },
};

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

/** Пресеты вида и зоны; у рукава из справочника зон — свой пресет перед «Центром зоны» */
export function studioPresets(view: FlatView, area: PrintArea): StudioPresetOption[] {
  const base = presetsFor(view, area).map((p) => ({ ...p, hint: HINTS[p.key] }));
  if (!isSleeve(view) || area.zone_id === null) return base;
  return [{ key: 'sleeve-standard', label: 'Лого на рукаве', hint: `${PRESET_WIDTH_MM['sleeve-standard']} мм, по центру рукава` }, ...base];
}

const boxOf = (pl: Geometry) => rotatedAabb({ x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm }, pl.rotation_deg);

/** Масштаб под ширину стандарта по видимой рамке, не больше зоны минус отступ (и по высоте) */
function scaledTo(view: FlatView, area: PrintArea, pl: Geometry, widthMm: number): Geometry {
  const { zone, safeInsetMm } = viewZone(view, undefined, area.id);
  const box = boxOf(pl);
  if (!(box.w > 0) || !(box.h > 0)) return pl;
  const maxW = Math.max(1, zone.zw - 2 * safeInsetMm);
  const maxH = Math.max(1, zone.zh - 2 * safeInsetMm);
  const k = Math.min(widthMm / box.w, maxW / box.w, maxH / box.h);
  const cx = pl.x_mm + pl.width_mm / 2;
  const cy = pl.y_mm + pl.height_mm / 2;
  const w = pl.width_mm * k;
  const h = pl.height_mm * k;
  return { ...pl, width_mm: w, height_mm: h, x_mm: cx - w / 2, y_mm: cy - h / 2 };
}

/**
 * Сдвиг внутрь зоны (узкая зона — левая грудь не уходит за край): слева, справа
 * и снизу — с безопасным отступом, сверху — по самой зоне (верх у горловины —
 * штатное место логотипа, как у предупреждения «у края зоны», Э1)
 */
function clampedToZone(view: FlatView, area: PrintArea, pl: Geometry): Geometry {
  const { zone, safeInsetMm: m } = viewZone(view, undefined, area.id);
  const box = boxOf(pl);
  const shift = (lo: number, hi: number, a: number, len: number) => (len > hi - lo ? lo + (hi - lo - len) / 2 - a : Math.min(Math.max(a, lo), hi - len) - a);
  return {
    ...pl,
    x_mm: pl.x_mm + shift(zone.zx + m, zone.zx + zone.zw - m, box.x, box.w),
    y_mm: pl.y_mm + shift(zone.zy, zone.zy + zone.zh - m, box.y, box.h),
  };
}

/**
 * Пресет: размер стандарта (если у пресета он есть) → место. Отступы — теми же
 * функциями, что поля инспектора (с поворотом), затем прижим к зоне.
 */
export function withStudioPreset(view: FlatView, area: PrintArea, pl: Geometry, preset: StudioPreset): Geometry {
  const width = (PRESET_WIDTH_MM as Partial<Record<StudioPreset, number>>)[preset];
  const sized = width ? scaledTo(view, area, pl, width) : pl;
  const std = FROM_NECKLINE[preset];
  if (std) return clampedToZone(view, area, withHorizontalOffset(view, area, withVerticalOffset(view, area, sized, std.down), std.dx));
  if (preset === 'sleeve-standard') return clampedToZone(view, area, withHorizontalOffset(view, area, withPreset(view, area, sized, 'center-zone'), 0));
  return withPreset(view, area, sized, preset);
}
