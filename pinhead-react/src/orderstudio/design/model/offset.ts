/**
 * Отступ нанесения из геометрии холста — таблица решения 4 плана вехи 5а
 * (по `placementInfo` DM) и уточнение проверки скиллами «по зоне и категории»:
 *
 * | Случай                                  | `offset_from` | мм и направление            |
 * |-----------------------------------------|---------------|-----------------------------|
 * | служебная зона (`zone_id = null`, бирка) | `top_edge`    | от верха зоны               |
 * | штаны (категория `pants`)                | `top_edge`    | от пояса (якорь горловины)  |
 * | одежда с горловиной                      | `neck_seam`   | от шва горловины            |
 * | изделие без горловины (шоппер)           | `top_edge`    | от верха зоны               |
 * | рукав (веха 5б)                          | `part_seam`   | от низа рукава              |
 *
 * Мм — целые, модуль; направление — по знаку (ниже опоры — `down`, у рукава
 * вверх от низа — `up`). `offset_note` холст не трогает.
 */
import type { PrintOffsetDir, PrintOffsetFrom } from '../../model/types';
import type { PlacementInfo } from '../geometry/view';
import type { PrintArea } from '../types';

export interface PrintOffset {
  offset_mm: number;
  offset_from: PrintOffsetFrom;
  offset_dir: PrintOffsetDir;
}

const mm = (v: number) => Math.round(Math.abs(v)) || 0;

/** Отступ от верха зоны: ниже верха — `down` */
function fromZoneTop(info: PlacementInfo): PrintOffset {
  const v = info.aabb.y - info.zone.zy;
  return { offset_mm: mm(v), offset_from: 'top_edge', offset_dir: v >= 0 ? 'down' : 'up' };
}

export function offsetFor(info: PlacementInfo, area: Pick<PrintArea, 'zone_id'>, category: string): PrintOffset {
  if (area.zone_id === null) return fromZoneTop(info);
  const { kind, vertical } = info.anchor;
  if (kind === 'sleeve') return { offset_mm: mm(vertical), offset_from: 'part_seam', offset_dir: vertical >= 0 ? 'up' : 'down' };
  if (kind === 'panel') return fromZoneTop(info);
  const dir: PrintOffsetDir = vertical >= 0 ? 'down' : 'up';
  return { offset_mm: mm(vertical), offset_from: category === 'pants' ? 'top_edge' : 'neck_seam', offset_dir: dir };
}
