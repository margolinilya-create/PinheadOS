/**
 * Проверка перед «Скачать PDF макета» (перенос DM `lib/export/preflight.ts`).
 * Только геометрия и файл; цену проверяет `priceOrder` (`ISSUE_LABELS`).
 * Ничего не блокирует (проверка скиллами, ответ владельца 17.10) — три уровня:
 * - `serious` — серьёзное предупреждение (DPI ниже нижнего порога, нет зоны);
 * - `warn` — предупреждение (DPI между порогами, выход за зону или ближе safe-отступа к краю, размер вне
 *   границ зоны, техника не для зоны, оценочный размер, флэт обновлён);
 * - `info` — подсказка (вышивка: мелкие детали не прошьются).
 *
 * Техника — наша (`SalesPrintMethod`); профиль и допустимость в зоне приходят
 * аргументами из `model/printMethods` (задача 1): `printMethodProfile` и
 * `allowedMethods(area, rules)` с правилами категории (`allowedZoneTechs`).
 */
import type { GarmentFlat, Placement, PrintArea, ProfileOf } from '../types';
import type { SalesPrintMethod } from '../../model/types';
import { placementInfo } from '../geometry/view';
import { rotatedAabb } from '../geometry/coords';
import { printQuality } from '../catalog/dpi';
import { methodSizeIssue } from '../../model/printMethods';

export type PreflightLevel = 'serious' | 'warn' | 'info';

export interface PreflightIssue {
  level: PreflightLevel;
  message: string;
  printKey?: string;
}

export interface PreflightInput {
  flat: GarmentFlat;
  placements: Placement[];
  profileOf: ProfileOf;
  /** Допустима ли техника в зоне (методы зоны ∩ правила категории) */
  methodAllowed: (area: PrintArea, method: SalesPrintMethod) => boolean;
  /** Силуэт позиции — от другой модели (`flatMismatch`, B1 вехи 5в) */
  modelMismatch?: boolean;
}

export const MSG_NO_PRINTS = 'На изделии нет нанесений — PDF будет без макета.';
export const MSG_MODEL_MISMATCH = 'Силуэт — от другой модели: перенесите нанесения на силуэт модели позиции.';

const ORDER: Record<PreflightLevel, number> = { serious: 0, warn: 1, info: 2 };

function checkPlacement(p: Placement, input: PreflightInput): PreflightIssue[] {
  const view = input.flat.views.find((v) => v.kind === p.view);
  const area = view?.print_areas.find((a) => a.id === p.area_id);
  if (!view || !area) return [{ level: 'serious', printKey: p.print_key, message: 'Нанесение: зона не найдена на силуэте — поставьте его заново.' }];
  const out: PreflightIssue[] = [];
  const add = (level: PreflightLevel, text: string) => out.push({ level, printKey: p.print_key, message: `«${area.name}»: ${text}` });
  const profile = input.profileOf(p.method);

  const { quality, dpi } = printQuality(p.asset, p.width_mm, profile);
  if (quality === 'low') add('serious', `разрешение ${Math.round(dpi ?? 0)} DPI для «${profile.label}» — печать будет размытой.`);
  if (quality === 'mid') add('warn', `разрешение ${Math.round(dpi ?? 0)} DPI для «${profile.label}» — лучше от ${profile.dpi?.good ?? 300}.`);
  if (profile.detail) {
    add('info', `вышивка: линии тоньше ${profile.detail.minLineMm} мм и текст меньше ${profile.detail.minTextMm} мм не прошьются.`);
  }
  if (p.asset.size_estimated) add('warn', 'размер файла оценочный — проверьте Ш×В.');
  if (p.stale) add('warn', 'силуэт обновлён после размещения — проверьте положение.');

  // Максимум — по занимаемой площади (повёрнутый AABB); минимум — по сырым Ш×В
  const occ = rotatedAabb({ x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm }, p.rotation_deg);
  const mx = area.max_print_mm;
  if (mx && (occ.w > mx.width || occ.h > mx.height)) {
    add('warn', `занимает ${Math.round(occ.w)}×${Math.round(occ.h)} мм с поворотом — больше максимума зоны ${mx.width}×${mx.height} мм.`);
  }
  const mn = area.min_print_mm;
  if (mn && (p.width_mm < mn.width || p.height_mm < mn.height)) {
    add('warn', `размер ${Math.round(p.width_mm)}×${Math.round(p.height_mm)} мм меньше минимума зоны ${mn.width}×${mn.height} мм.`);
  }
  const sizeIssue = methodSizeIssue(p.method, p.width_mm, p.height_mm);
  if (sizeIssue) add('warn', `${sizeIssue.text}.`);
  if (!input.methodAllowed(area, p.method)) add('warn', `техника «${profile.label}» не для этой зоны.`);

  const bbox = { x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm };
  const info = placementInfo(view, bbox, p.rotation_deg, undefined, area.id);
  if (info.check.out_of_zone) add('warn', 'выходит за печатную зону.');
  // Верхний край не проверяем: его задаёт отступ от шва горловины (стандарт Pinhead
  // «75 мм от горловины» стоит ближе safe-отступа сида — иначе пункт горел бы на каждом логотипе)
  else if (Math.min(info.dimensions.left, info.dimensions.right, info.dimensions.bottom) < info.safeInsetMm) {
    add('warn', `до края зоны меньше ${Math.round(info.safeInsetMm)} мм — при печати рисунок может съехать за край.`);
  }
  return out;
}

/** Замечания перед экспортом: серьёзные впереди */
export function preflight(input: PreflightInput): PreflightIssue[] {
  const head: PreflightIssue[] = input.modelMismatch ? [{ level: 'serious', message: MSG_MODEL_MISMATCH }] : [];
  if (input.placements.length === 0) return [...head, { level: 'serious', message: MSG_NO_PRINTS }];
  return [...head, ...input.placements
    .flatMap((p) => checkPlacement(p, input))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level])];
}
