import { MATERIAL_KIND_LABELS, MATERIAL_ROLE_LABELS } from '../types';
import type { MaterialKind, MaterialRole } from '../types';

/**
 * ВИД и НАЗНАЧЕНИЕ материала — два классификатора, и владелец решил 05.09
 * оставить оба. Значит разница обязана читаться без объяснений.
 *
 * ЧТО БЫЛО. Словари пересекались ДОСЛОВНО: четыре ключа «Назначения» из семи
 * повторяли «Вид» (`hardware`, `labels`, `packaging`, `other`), форма при этом
 * предлагала все семь при любом виде и подставляла `main` по умолчанию —
 * молния уезжала в базу «Основным полотном». На проде это видно прямо: из 44
 * строк у 40 назначение пустое, а из четырёх заполненных ДВЕ дословно повторяют
 * вид (`hardware/hardware`, `labels/labels`) и только две несут смысл — и обе
 * про ткань (`fabric/main`, `fabric/trim`). Печатный лист закупки показывал
 * такую пару соседними колонками: «фурнитура | Фурнитура».
 *
 * ЧТО СТАЛО. Назначение спрашивается ТОЛЬКО у ткани и только теми значениями,
 * которых нет среди видов. Набор не перечислен руками, а ВЫВЕДЕН: назначение
 * несёт информацию ровно тогда, когда его ключа нет в видах. Заведут новый вид,
 * совпадающий с назначением, — оно отсюда выпадет само, без правки списка.
 *
 * ЧТО НЕ МЕНЯЛОСЬ. `MaterialRole`, `MATERIAL_ROLE_LABELS` и CHECK базы остаются
 * при семи значениях: две строки на проде заведены со старым назначением,
 * а историю задним числом не переписывают (то же правило, что у
 * `subcontract.status`). Гейт стоит там, где человек выбирает, — в форме.
 */

/** Ключи, которые у назначения и вида ОДИНАКОВЫ: такое назначение ничего не добавляет */
const ROLE_SAME_AS_KIND: ReadonlySet<string> = new Set(Object.keys(MATERIAL_KIND_LABELS));

/** Вид, у которого назначение вообще о чём-то говорит */
export const ROLE_KIND: MaterialKind = 'fabric';

/** Назначения, НЕСУЩИЕ информацию: их нет среди видов материала */
export const FABRIC_ROLE_VALUES: readonly MaterialRole[] =
  (Object.keys(MATERIAL_ROLE_LABELS) as MaterialRole[])
    .filter((role) => !ROLE_SAME_AS_KIND.has(role));

/** Спрашивать ли назначение у материала этого вида */
export function kindHasRole(kind: string | null | undefined): boolean {
  return kind === ROLE_KIND;
}

/**
 * Подпись назначения к показу — или `null`, когда показывать нечего.
 *
 * Пусто и у незаполненного назначения, и у того, что лишь повторяет вид:
 * рядом всегда стоит «Вид» с тем же словом, и второй раз оно не нужно.
 */
export function materialRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  if (!FABRIC_ROLE_VALUES.includes(role as MaterialRole)) return null;
  return MATERIAL_ROLE_LABELS[role as MaterialRole];
}

/** Назначение к записи: у не-ткани его нет, каким бы ни осталось состояние формы */
export function materialRoleForKind(
  kind: string | null | undefined,
  role: string | null | undefined,
): MaterialRole | null {
  if (!kindHasRole(kind) || !role) return null;
  return FABRIC_ROLE_VALUES.includes(role as MaterialRole) ? (role as MaterialRole) : null;
}
