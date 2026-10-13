/**
 * Список менеджеров для поля «Менеджер» формы создания заказа
 * (правки заказчика 07.09, п. 1: «Сделать поле „Менеджер“ выпадающим списком
 * с выбором менеджера»).
 *
 * ПОЧЕМУ РОЛЕЙ ЧЕТЫРЕ, А НЕ ОДНА. Проверено на боевой базе перед правкой:
 * в `erp_employees` заведено пять человек — один директор и четыре
 * руководителя производства, и НИ ОДНОГО с ролью `manager`. Список строго
 * по «менеджеру сопровождения» был бы пустым, то есть поле «Менеджер»
 * нельзя было бы заполнить ни в одном новом заказе: механизм, который
 * на живой базе не даёт результата, — не исполненное требование.
 *
 * ПОЧЕМУ СПИСОК НЕ ЗАКРЫТЫЙ. Значение уезжает в `erp_orders.manager` —
 * свободный `text`, и в заведённых заказах там лежат «Никита», «никита»,
 * «игорь», «Александ» и «=»: людей, ведущих заказы, в справочнике
 * сотрудников больше, чем учётных записей. Поэтому `datalist` поверх
 * свободного ввода — тот же приём, что у справочников раздела
 * («подсказка, а не ограничение»): список убирает разнобой, но не запирает
 * заказ из-за незаведённого сотрудника.
 */

import type { EmployeeRole, ErpEmployee } from '../types';
import type { StaffProfile } from '../store/types';

/**
 * Кто ведёт заказ. Роли перечислены поимённо, а не «все кроме цеховых»:
 * отрицательный список молча принимал бы каждую новую роль.
 */
export const MANAGER_ROLES: EmployeeRole[] = [
  'manager',
  'director',
  'production_head',
  'dispatcher',
];

const MANAGER_ROLE_SET = new Set<string>(MANAGER_ROLES);

/**
 * Имена для подсказки поля «Менеджер».
 *
 * Имя берётся у СОТРУДНИКА (`full_name`), а при пустом — у профиля: правка
 * имени идёт в два места (`profiles.name` и `erp_employees.full_name`), и
 * заполнено бывает то одно, то другое. Почта как имя не годится — её человек
 * в заказе не пишет.
 */
export function managerOptions(
  employees: ErpEmployee[] = [],
  profiles: StaffProfile[] = [],
): string[] {
  const nameByProfile = new Map<string, string>();
  for (const p of profiles) {
    const name = (p.name ?? '').trim();
    if (p.id && name) nameByProfile.set(p.id, name);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of employees) {
    if (e.active === false) continue;
    if (!MANAGER_ROLE_SET.has(e.role)) continue;
    const name = (e.full_name ?? '').trim()
      || (e.profile_id ? nameByProfile.get(e.profile_id) ?? '' : '');
    if (!name) continue;
    // Тёзки в списке не дублируются: значение — строка, и два одинаковых
    // пункта неразличимы по построению
    const key = name.toLocaleLowerCase('ru');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'));
}
