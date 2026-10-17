/**
 * Границы данных дизайна — одни для справочника флэтов (`catalog/flatsSchema`),
 * раскладки нанесения (`model/layout`) и проверки файла (`assets/sniff`).
 * Отдельным модулем, чтобы раскладка (чанк холста) не тянула схему справочника.
 *
 * Числа справочника — те же, что у серверной проверки `catalog_value_check`
 * ветки `garmentFlats` (миграция H, задача 2; проверка безопасности L2).
 */
import type { FlatViewKind } from './types';

/** id флэта — та же форма, что в пути бакета флэтов (`FLATS_BUCKET`) и CHECK `order_items.flat_id` */
export const FLAT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** id зоны флэта и `zone_id` справочника зон */
export const AREA_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const MAX_FLAT_VERSION = 9999;
export const MAX_NAME_LEN = 200;
/** |координата| флэта, мм */
export const MAX_COORD_MM = 5000;
export const MAX_POLYGON_POINTS = 256;
export const MAX_SCALE_MM_PER_UNIT = 10;
export const MAX_SOURCE_FILE_LEN = 255;

/** Бомбы: сторона растра и площадь (проверка безопасности M2) */
export const MAX_PX_SIDE = 12000;
export const MAX_PX_AREA = 80_000_000;
/** Предел SVG-текста, байт (M1) */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

/**
 * Путь SVG вида в бакете — формула, которую сверяют и клиент (M5), и сервер:
 * справочник не может направить флэт на чужой объект.
 */
export function flatSvgPathOf(id: string, version: number, kind: FlatViewKind): string {
  return `flats/${id}/v${version}/${kind}.svg`;
}
