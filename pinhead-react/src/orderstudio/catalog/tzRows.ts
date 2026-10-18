/**
 * Строки матрицы ТЗ (веха 5б, решение контроллера К8): куда ложится нанесение
 * в таблице ТЗ. Перечень кодов — один на клиент и сервер: тот же список
 * проверяет ветка `garmentFlats` и `zonesCatalog` в `catalog_value_check`
 * (миграция I), его же прочтёт `tzDocument` вехи 6.
 *
 * Цепочка выбора строки: `area.tz_row` (переопределение у зоны флэта — например,
 * полочки Л и П у зип-худи) → `zone.tz_row` (справочник зон) →
 * `DEFAULT_TZ_ROW_BY_ZONE[zone.id]` (код) → `other`.
 *
 * Колонки техник ТЗ (`tzColumnOf(method, executor)`) — веха 6 (решение 23).
 *
 * Модуль без зависимостей времени выполнения: его читают и схема справочника
 * флэтов (чанк холста), и редактор справочника зон.
 */
import type { PrintArea } from '../design/types';

/** 9 строк матрицы ТЗ в порядке таблицы */
export const TZ_MATRIX_ROWS = ['front', 'front_l', 'front_r', 'back', 'sleeve_l', 'sleeve_r', 'hood_l', 'hood_r', 'pocket'] as const;
export type TzRow = (typeof TZ_MATRIX_ROWS)[number] | 'other';

/** Все коды строк: 9 строк матрицы и «Другое» — тот же список, что в SQL миграции I */
export const TZ_ROW_CODES: readonly TzRow[] = [...TZ_MATRIX_ROWS, 'other'];

export const TZ_ROW_LABELS: Record<TzRow, string> = {
  front: 'Полочка',
  front_l: 'Полочка Л',
  front_r: 'Полочка П',
  back: 'Спинка',
  sleeve_l: 'Рукав Л',
  sleeve_r: 'Рукав П',
  hood_l: 'Капюшон Л',
  hood_r: 'Капюшон П',
  pocket: 'Карман',
  other: 'Другое',
};

/**
 * Строка ТЗ по умолчанию для зон справочника `ZONES_CATALOG_DEFAULT`.
 * Капюшон — «Другое» (решение 3): зона `hood` одна, а строк две (Л и П);
 * Л или П ставится в справочнике зон или у зоны флэта.
 */
export const DEFAULT_TZ_ROW_BY_ZONE: Record<string, TzRow> = {
  front: 'front',
  back: 'back',
  'sleeve-l': 'sleeve_l',
  'sleeve-r': 'sleeve_r',
  pocket: 'pocket',
  hood: 'other',
  'side-a': 'other',
  'side-b': 'other',
  'leg-l': 'other',
  'leg-r': 'other',
  'pants-front': 'other',
  'pants-back': 'other',
};

/**
 * id зоны справочника и `zone_id` зоны флэта — один источник: «Добавить зону»
 * (`zonesEdit`), схема справочника флэтов и сторож SQL миграции I
 * (исходник регулярки в обеих ветках I равен `ZONE_ID_RE.source`)
 */
export const ZONE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const CODES = new Set<string>(TZ_ROW_CODES);

/** Код строки ТЗ из перечня; иначе `null` (свободный текст веха 6 не сопоставит) */
export function asTzRow(v: unknown): TzRow | null {
  return typeof v === 'string' && CODES.has(v) ? (v as TzRow) : null;
}

/** Строка ТЗ зоны справочника: её `tz_row` → умолчание по id → «Другое» */
export function tzRowOfZone(zone: { id: string; tz_row?: string } | undefined): TzRow {
  if (!zone) return 'other';
  return asTzRow(zone.tz_row) ?? DEFAULT_TZ_ROW_BY_ZONE[zone.id] ?? 'other';
}

/** Строка ТЗ зоны флэта: переопределение у зоны → зона справочника → умолчание по `zone_id` → «Другое» */
export function tzRowOfArea(
  area: Pick<PrintArea, 'zone_id' | 'tz_row'>,
  zones: readonly { id: string; tz_row?: string }[],
): TzRow {
  const own = asTzRow(area.tz_row);
  if (own) return own;
  if (area.zone_id === null) return 'other';
  return tzRowOfZone(zones.find((z) => z.id === area.zone_id) ?? { id: area.zone_id });
}

type NamedZone = { id: string; name?: string; tz_row?: string };

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Код зоны справочника по её названию (веха 8, К5): строка нанесения выбирает
 * зону названием из подсказки, а цена кармана и строка ТЗ читают код. Название
 * не найдено или код не по формату `ZONE_ID_RE` — null (свободный текст)
 */
export function zoneIdByName(name: string | null | undefined, zones: readonly NamedZone[] | null | undefined): string | null {
  const key = norm(name);
  if (!key || !Array.isArray(zones)) return null;
  const id = zones.find((z) => norm(z.name) === key)?.id;
  return typeof id === 'string' && ZONE_ID_RE.test(id) ? id : null;
}

/**
 * Зона справочника нанесения: по `zone_id` (нет в справочнике — сам код, его строка
 * по умолчанию), без кода — по названию (строки до вехи 8 и свободный текст)
 */
export function zoneOfPrint(
  print: { zone: string; zone_id: string | null },
  zones: readonly NamedZone[],
): { id: string; tz_row?: string } | undefined {
  if (print.zone_id) return zones.find((z) => z.id === print.zone_id) ?? { id: print.zone_id };
  const key = norm(print.zone);
  return key ? zones.find((z) => norm(z.name) === key) : undefined;
}
