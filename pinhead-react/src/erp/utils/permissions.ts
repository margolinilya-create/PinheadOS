/**
 * Права ролей (ядро правки 11) — чистая логика, покрыта тестами.
 *
 * Матрица «роль × право» живёт в БД (erp_role_permissions) и правится админом.
 * Здесь: приведение двух словарей ролей к одному, дефолты-fallback и разрешение права.
 *
 * Матрица отвечает на вопрос «что этой роли вообще можно». Ограничение «только свой цех»
 * — отдельная проверка (canActInDept), матрицей не отменяется: бригадир швейки не должен
 * закрывать этапы вышивки, даже имея право stage.complete.
 */

import type { EmployeeRole, ErpPermission } from '../types';
// Импорт ИЗ МОДУЛЯ-ЛИСТА, а не из `../types` через реэкспорт: реэкспорт
// втянул бы весь чанк словарей подписей обратно в критический путь
import { ERP_PERMISSIONS } from '../permissionKeys';

/** Роли профиля Order Studio с полным доступом ко всем цехам */
export const FULL_ACCESS_PROFILE_ROLES = ['admin', 'director', 'rop'];

/** Роль профиля (Order Studio) → цеховая роль, если сотрудник не заведён в erp_employees */
const PROFILE_ROLE_FALLBACK: Record<string, EmployeeRole> = {
  admin: 'director',
  director: 'director',
  rop: 'dispatcher',
  manager: 'manager',
  production: 'worker',
  designer: 'worker',
};

/**
 * Единая роль для матрицы прав.
 * admin/director всегда «director» — руководство не должно терять доступ из-за того,
 * что кто-то поставил ему цеховую роль «сотрудник цеха».
 */
export function resolveErpRole(
  profileRole: string | null | undefined,
  employeeRole: EmployeeRole | null | undefined,
): EmployeeRole {
  if (profileRole === 'admin' || profileRole === 'director') return 'director';
  if (employeeRole) return employeeRole;
  return PROFILE_ROLE_FALLBACK[profileRole ?? ''] ?? 'worker';
}

/**
 * Дефолты на случай, когда матрица ещё не загрузилась или права нет в таблице.
 * Зеркалит seed из 20260727130000_erp_role_permissions.sql — цех не должен вставать,
 * если запрос за матрицей не прошёл.
 */
export const DEFAULT_PERMISSIONS: Record<EmployeeRole, ErpPermission[]> = {
  director: [...ERP_PERMISSIONS],
  /**
   * Руководитель производства ведёт план и всю диспетчеризацию, включая
   * справочники: `catalog.edit` подтверждён заказчиком 10.08 как осознанная
   * правка — на боевой базе он был включён, и запасные значения приведены
   * к базе, а не наоборот.
   *
   * Аварийное снятие блокировок (`bypass.manage`) сюда НЕ входит: оно затрагивает
   * всё производство разом, поэтому по умолчанию остаётся у директора. Раздать
   * шире — галочкой в матрице, на то она и есть.
   */
  production_head: ERP_PERMISSIONS.filter(
    // Образцы ведёт технолог: разработка — не производственный поток.
    // Приглашения — тоже не его: они раздают права и заводят учётные записи,
    // это решение руководства (seed миграции даёт `staff.invite` директору)
    (p) => p !== 'bypass.manage' && p !== 'experimental.manage' && p !== 'staff.invite',
  ),
  /**
   * Диспетчер план НЕ ставит — за это отвечает руководитель производства.
   * Склад тоже не его: он распоряжается очередью цехов, а не физическим
   * движением товара.
   */
  dispatcher: ERP_PERMISSIONS.filter(
    (p) => p !== 'catalog.edit' && p !== 'plan.manage' && p !== 'bypass.manage'
      && p !== 'experimental.manage' && p !== 'warehouse.manage'
      && p !== 'staff.invite',
  ),
  foreman: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'stage.priority',
    'plan.fact',
  ],
  worker: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'plan.fact',
  ],
  /**
   * Технолог ведёт экспериментальный цех и образцы: работа мастера плюс ТЗ —
   * по образцу он и есть тот, кто задаёт техническое задание.
   */
  technologist: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect',
    'stage.priority', 'plan.fact', 'tz.manage',
    /**
     * Разработка образцов — его основная работа, и без этого права она
     * недоступна: этап образца заводится под ним. Нашлось живой проверкой —
     * `erp_experimental_send_to_dept` падала на 42501 у того самого человека,
     * ради которого раздел и существует.
     */
    'experimental.manage',
  ],
  /**
   * Участки нанесения: права ровно как у сотрудника цеха. Различает их не право,
   * а привязка к цеху — поэтому четыре одинаковых строки здесь не дублирование,
   * а честное «по правам они равны».
   */
  dtf: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'plan.fact',
  ],
  silkscreen: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'plan.fact',
  ],
  embroidery: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'plan.fact',
  ],
  dtg: [
    'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect', 'plan.fact',
  ],
  /**
   * tz.manage приходит из отдельной миграции (волна 4) — в seed менеджер его имеет,
   * и без него менеджер молча терял бы возможность вести ТЗ, если матрица не загрузилась.
   *
   * `stage.move_department` добавлен решением заказчика 10.08: заказ ведёт менеджер,
   * и перекидывать задание между участками он должен уметь сам. Замечание, ради
   * которого это записано: перенос меняет загрузку производства, то есть менеджер
   * теперь влияет на неё без ведома диспетчера.
   */
  manager: ['stage.block', 'stage.priority', 'stage.move_department', 'order.manage', 'tz.manage'],
  /**
   * material.receive (волна 2 правок менеджера): приёмка — работа закупки и склада.
   * warehouse.manage (10.08): движение складских задач — маркировка, приёмка
   * готовой продукции, упаковка и отгрузка. Приёмкой материалов оно не
   * покрывается, поэтому права два, а не одно.
   *
   * stage.take + stage.complete (12.08): «Закупка» — обычный этап маршрута,
   * и закрывается он тем же переходом в `done`, что любой другой. Без
   * `stage.complete` человек, ради которого раздел существует, получал 42501
   * от стража на СВОЁМ этапе, и весь маршрут за закупкой стоял.
   *
   * `stage.progress` сюда НЕ входит: результат в штуках закупка не выпускает,
   * а приход материала частями ведёт свой журнал под `material.receive`.
   * `stage.defect` — тем более: возврат брака откатывает производственный
   * маршрут, это решение цеха и менеджера.
   */
  purchaser: [
    'stage.block', 'stage.take', 'stage.complete', 'material.receive', 'warehouse.manage',
  ],
  /**
   * У кладовщика набор прежний: этапа в маршруте у склада нет вовсе, его
   * задачи живут в `erp_warehouse_tasks` под `warehouse.manage`. Выдать ему
   * `stage.complete` «заодно с закупщиком» значило бы завести право, которое
   * ничего не открывает.
   */
  storekeeper: ['stage.block', 'material.receive', 'warehouse.manage'],
  hr: [],
  /**
   * Новичок до назначения должности. Пусто здесь так же обязательно, как
   * в матрице БД: `DEFAULT_PERMISSIONS` — это то, что действует, когда матрица
   * не загрузилась, и непустая строка выдала бы права ровно в тот момент,
   * когда проверить их некому.
   */
  pending: [],
};

/** Матрица из БД: роль → право → разрешено */
export type PermissionMatrix = Record<string, Record<string, boolean>>;

/** Разрешено ли право роли: сперва матрица из БД, иначе дефолт */
export function isAllowed(
  matrix: PermissionMatrix | null | undefined,
  role: EmployeeRole,
  permission: ErpPermission,
): boolean {
  const fromDb = matrix?.[role]?.[permission];
  if (typeof fromDb === 'boolean') return fromDb;
  return DEFAULT_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Роли, которые существуют ТОЛЬКО в привязке к участку.
 *
 * Для них пустой `erp_employees.department_id` — это незаконченное заведение
 * сотрудника, а не «работает везде»: рабочий без цеха не бывает.
 *
 * Остальные роли (менеджер, диспетчер, руководитель производства, технолог,
 * директор) сквозные по смыслу — они ведут заказ или производство целиком,
 * и привязка их не ограничивает. Для них fail-open сохраняется.
 */
export const DEPT_BOUND_ROLES: EmployeeRole[] = [
  'worker', 'foreman', 'dtf', 'silkscreen', 'embroidery', 'dtg',
  'storekeeper', 'purchaser',
];

/**
 * Может ли пользователь действовать в конкретном цехе.
 * Руководящий состав — везде; привязанный сотрудник — только в своём цехе.
 *
 * **Про отсутствие привязки.** Здесь долго стоял безусловный fail-open
 * с доводом: «что такому пользователю можно, решает матрица — роль `manager`
 * без цеха всё равно не получит „Взять в работу“, потому что этого права нет
 * у роли». Для менеджера довод верен. Для ролей участка — нет: у `worker`
 * и `foreman` есть `stage.take`/`complete`/`defect`, у `purchaser` — ещё
 * и `warehouse.manage`, у `storekeeper` — `stage.block`. Матрица их
 * не останавливает, привязки нет — значит, рабочий работал бы на всей фабрике.
 *
 * Довод про «в цехах, где сотрудников ещё не завели, запрет остановил бы
 * производство» тоже не действует: он про цех БЕЗ людей, а речь о человеке
 * БЕЗ цеха. Заведение сотрудника без участка — незаконченная работа админа,
 * и правильный ответ на неё — сказать об этом, а не молча раздать доступ.
 *
 * Отказ обязан быть видимым: интерфейс объясняет «профиль не привязан
 * к участку», а не просто прячет кнопки.
 */
export function canActInDept(
  profileRole: string | null | undefined,
  erpRole: EmployeeRole,
  myDeptId: string | null | undefined,
  deptId: string | null | undefined,
  isDevUser = false,
): boolean {
  if (isDevUser) return true;
  if (FULL_ACCESS_PROFILE_ROLES.includes(profileRole ?? '')) return true;
  if (!myDeptId) return !DEPT_BOUND_ROLES.includes(erpRole);
  return Boolean(deptId) && myDeptId === deptId;
}
