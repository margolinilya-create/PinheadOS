/**
 * Зоны нового вида по умолчанию (веха 5б, решение 21): перед — `front`,
 * спина — `back`, рукав — `sleeve-l`/`sleeve-r`; у штанов — `pants-front`/
 * `pants-back`, у шоппера — стороны A и B. Прямоугольник по центру силуэта
 * с отступом. Зоны нет в справочнике или она снята — служебная зона
 * (`zone_id = null`) с именем вида: администратор привяжет её сам.
 */
import type { ZoneDefinition } from '../../../types/catalog';
import { VIEW_LABELS } from '../catalog/flatLabels';
import type { FlatViewKind, GarmentType, PrintArea } from '../types';
import { rectArea, type FlatMm } from './flatEdit';

/** Зона справочника в той мере, в какой её знает редактор (поля 5б — `tz_row`, `active`) */
export type ZoneLike = ZoneDefinition & { tz_row?: string; active?: boolean };

/** Доля силуэта под зону по умолчанию и отступ от края */
const AREA_SHARE = 0.5;
const MAX_INSET_MM = 10;

const tenth = (v: number) => Math.round(v * 10) / 10;

/** Зона справочника для вида и типа изделия */
export function defaultZoneId(kind: FlatViewKind, type: GarmentType): string {
  if (kind === 'sleeve_left') return 'sleeve-l';
  if (kind === 'sleeve_right') return 'sleeve-r';
  if (type === 'pants') return kind === 'front' ? 'pants-front' : 'pants-back';
  if (type === 'shopper') return kind === 'front' ? 'side-a' : 'side-b';
  return kind;
}

/** Зоны нового вида: одна, прямоугольник по центру; справочник зон не загрузился — служебная */
export function defaultAreas(
  kind: FlatViewKind, garment_type: GarmentType, flatMm: FlatMm, zonesCatalog: readonly ZoneLike[] | null,
): PrintArea[] {
  const w = tenth(flatMm.w * AREA_SHARE);
  const h = tenth(flatMm.h * AREA_SHARE);
  const rect = { x: tenth((flatMm.w - w) / 2), y: tenth((flatMm.h - h) / 2), w, h };
  const inset = tenth(Math.min(MAX_INSET_MM, Math.min(w, h) / 4));
  const zoneId = defaultZoneId(kind, garment_type);
  const zone = zonesCatalog?.find((z) => z.id === zoneId && z.active !== false);
  if (zone) return [rectArea(zoneId, zone.name, zoneId, rect, inset)];
  return [rectArea(kind, VIEW_LABELS[kind], null, rect, inset)];
}
