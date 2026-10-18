/**
 * Чистые операции справочника зон нанесения `app_config.zonesCatalog`
 * (веха 5б, задача 4; решение контроллера К8).
 *
 * Правила (зеркало ветки `zonesCatalog` в `catalog_value_check` и стража
 * `app_config_order_catalog_guard` миграции I):
 *   · id — `ZONE_ID_RE`, уникален; после сохранения не меняется;
 *   · название — непустое, ≤ 200, уникально без регистра и пробелов по краям;
 *     после сохранения не меняется: оно — ключ нанесения в заказах
 *     (`SalesPrint.zone`); опечатку исправляют снятием зоны и новой зоной;
 *   · зона не удаляется, а снимается (`active: false`);
 *   · `tz_row` — код из `TZ_ROW_CODES`, пустое значение — ключа нет
 *     (сервер не принимает `null`).
 * Операции не меняют входной список — возвращают новый.
 */
import type { ZoneDefinition } from '../../../types/catalog';
import { asTzRow, TZ_ROW_LABELS, tzRowOfZone, ZONE_ID_RE } from '../../catalog/tzRows';

/** Предел длины названия зоны — как у сервера */
export const ZONE_NAME_MAX = 200;

export interface ZoneIssue {
  /** id зоны, к которой относится замечание */
  id: string;
  message: string;
}

type ZonePatch = Partial<Pick<ZoneDefinition, 'tz_row' | 'requiresHood' | 'requiresPocket' | 'forCategories' | 'name'>>;

const nameKey = (name: string): string => name.trim().toLowerCase();

/** Порядок показа: по `sortOrder`, без него — в конце; порядок равных сохраняется */
export function sortedZones(zones: readonly ZoneDefinition[]): ZoneDefinition[] {
  return [...zones].sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER));
}

/** Почему зону нельзя добавить; `null` — можно */
export function addZoneError(zones: readonly ZoneDefinition[], id: string, name: string): string | null {
  const cleanId = id.trim();
  if (!cleanId) return 'Введите id зоны';
  if (!ZONE_ID_RE.test(cleanId)) return 'id зоны — латиница в нижнем регистре, цифры, «-» и «_», до 63 знаков';
  if (zones.some((z) => z.id === cleanId)) return `Зона с id «${cleanId}» уже есть`;
  const cleanName = name.trim();
  if (!cleanName) return 'Введите название зоны';
  if (cleanName.length > ZONE_NAME_MAX) return `Название зоны — не длиннее ${ZONE_NAME_MAX} знаков`;
  const twin = zones.find((z) => nameKey(z.name) === nameKey(cleanName));
  if (twin) return `Зона «${twin.name}» уже есть — название должно отличаться`;
  return null;
}

/** Новая зона в конце списка: для всех категорий, в подборе */
export function addZone(zones: readonly ZoneDefinition[], draft: { id: string; name: string }): ZoneDefinition[] {
  const last = zones.reduce((m, z) => Math.max(m, z.sortOrder ?? 0), 0);
  return [...zones, { id: draft.id.trim(), name: draft.name.trim(), forCategories: null, sortOrder: last + 1 }];
}

/** Правка полей одной зоны; `tz_row: ''` убирает ключ (строка — по умолчанию) */
export function setZoneField(zones: readonly ZoneDefinition[], id: string, patch: ZonePatch): ZoneDefinition[] {
  return zones.map((z) => {
    if (z.id !== id) return z;
    const next: ZoneDefinition = { ...z, ...patch };
    if ('tz_row' in patch && !patch.tz_row) delete next.tz_row;
    return next;
  });
}

/**
 * Чип категории: снять или поставить. `null` у зоны — «все категории»;
 * набор, совпавший со всеми категориями, снова становится `null`.
 */
export function setZoneCategories(
  zones: readonly ZoneDefinition[], id: string, categoryId: string, allIds: readonly string[],
): ZoneDefinition[] {
  const zone = zones.find((z) => z.id === id);
  if (!zone) return [...zones];
  const current = zone.forCategories ?? [...allIds];
  const next = current.includes(categoryId) ? current.filter((c) => c !== categoryId) : [...current, categoryId];
  const isAll = allIds.every((c) => next.includes(c));
  return setZoneField(zones, id, { forCategories: isAll ? null : next });
}

/** Сдвиг зоны на одну позицию; `sortOrder` пересчитывается 1..n по новому порядку */
export function moveZone(zones: readonly ZoneDefinition[], id: string, dir: -1 | 1): ZoneDefinition[] {
  const list = sortedZones(zones);
  const i = list.findIndex((z) => z.id === id);
  const j = i + dir;
  if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  return list.map((z, k) => (z.sortOrder === k + 1 ? z : { ...z, sortOrder: k + 1 }));
}

/** Снять зону с подбора или вернуть (ключ `active` убирается — зона снова в подборе) */
export function toggleZoneActive(zones: readonly ZoneDefinition[], id: string): ZoneDefinition[] {
  return zones.map((z) => {
    if (z.id !== id) return z;
    if (z.active === false) {
      const next = { ...z };
      delete next.active;
      return next;
    }
    return { ...z, active: false };
  });
}

/** Замечания справочника перед сохранением; `saved` — справочник, прочитанный из базы */
export function zoneErrors(zones: readonly ZoneDefinition[], saved: readonly ZoneDefinition[]): ZoneIssue[] {
  const issues: ZoneIssue[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const z of zones) {
    if (ids.has(z.id)) issues.push({ id: z.id, message: `id «${z.id}» повторяется` });
    else if (!ZONE_ID_RE.test(z.id)) issues.push({ id: z.id, message: `id «${z.id}» — латиница, цифры, «-» и «_», до 63 знаков` });
    ids.add(z.id);
    const name = typeof z.name === 'string' ? z.name.trim() : '';
    if (!name) issues.push({ id: z.id, message: `Введите название зоны «${z.id}»` });
    else if (name.length > ZONE_NAME_MAX) issues.push({ id: z.id, message: `Название зоны «${z.id}» длиннее ${ZONE_NAME_MAX} знаков` });
    else if (names.has(nameKey(name))) issues.push({ id: z.id, message: `Название «${name}» повторяется` });
    if (name) names.add(nameKey(name));
    if (z.tz_row !== undefined && !asTzRow(z.tz_row)) {
      issues.push({ id: z.id, message: `Строка ТЗ зоны «${name || z.id}» неизвестна — выберите из списка` });
    }
  }
  for (const s of saved) {
    const now = zones.find((z) => z.id === s.id);
    if (!now) issues.push({ id: s.id, message: `Зону «${s.name}» нельзя удалить — снимите её с подбора` });
    else if (now.name !== s.name) {
      issues.push({ id: s.id, message: `Название сохранённой зоны «${s.name}» менять нельзя — снимите её и добавьте новую` });
    }
  }
  return issues;
}

/** Подпись пустого значения «Строки ТЗ»: строка по умолчанию для id зоны */
export function defaultTzRowLabel(id: string): string {
  return `по умолчанию: ${TZ_ROW_LABELS[tzRowOfZone({ id })]}`;
}
