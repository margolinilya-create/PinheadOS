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
import { ERP_PERMISSIONS } from '../types';

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
    // Образцы ведёт технолог: разработка — не производственный поток
    (p) => p !== 'bypass.manage' && p !== 'experimental.manage',
  ),
  /**
   * Диспетчер план НЕ ставит — за это отвечает руководитель производства.
   * Склад тоже не его: он распоряжается очередью цехов, а не физическим
   * движением товара.
   */
  dispatcher: ERP_PERMISSIONS.filter(
    (p) => p !== 'catalog.edit' && p !== 'plan.manage' && p !== 'bypass.manage'
      && p !== 'experimental.manage' && p !== 'warehouse.manage',
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
   * а привязка к цеху — поэтому три одинаковых строки здесь не дублирование,
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
 * Может ли пользователь действовать в конкретном цехе.
 * Руководящий состав — везде; привязанный сотрудник — только в своём цехе;
 * без привязки (legacy-выбор цеха через localStorage) — в выбранном.
 *
 * Отсутствие привязки намеренно не запрещает действия: в цехах, где сотрудников
 * ещё не завели в `erp_employees`, запрет остановил бы производство. Что именно
 * такому пользователю можно, решает матрица прав — например, роль `manager`
 * без привязки не получит ни «Взять в работу», ни «Завершить этап», ни «Брак»,
 * потому что этих прав нет у роли, а не потому что нет цеха.
 */
export function canActInDept(
  profileRole: string | null | undefined,
  myDeptId: string | null | undefined,
  deptId: string | null | undefined,
  isDevUser = false,
): boolean {
  if (isDevUser) return true;
  if (FULL_ACCESS_PROFILE_ROLES.includes(profileRole ?? '')) return true;
  if (!myDeptId) return true;
  return Boolean(deptId) && myDeptId === deptId;
}

/**
 * Действующее лицо, каким его видят и экраны, и слайсы стора.
 *
 * Нужно потому, что гейт понадобился ВНЕ React. `useErpAccess` — хук, а
 * побочные эффекты стора (автозакрытие закупки при приёмке материала) правами
 * не спрашивались вовсе: действие просто уходило на сервер и получало 42501
 * от стража. Вторую копию правил заводить нельзя — это ровно тот случай,
 * когда «две реализации дают худший отказ», поэтому и хук, и стор зовут
 * функции ниже.
 */
export interface ErpActor {
  /** Роль профиля Order Studio (useAuthStore) */
  profileRole?: string | null;
  /** Локальный dev-автологин — полный доступ, как на всех экранах */
  isDev?: boolean;
  /** Цеховая роль (erp_employees.role) */
  employeeRole?: EmployeeRole | null;
  /** Цех сотрудника; null — привязки нет */
  myDeptId?: string | null;
  /** Матрица из БД; null — работают DEFAULT_PERMISSIONS */
  matrix?: PermissionMatrix | null;
}

/** «Что этой роли вообще можно» — без учёта цеха */
export function actorCan(actor: ErpActor, permission: ErpPermission): boolean {
  if (actor.isDev) return true;
  return isAllowed(actor.matrix, resolveErpRole(actor.profileRole, actor.employeeRole), permission);
}

/** Право И принадлежность цеху — основной гейт действия над этапом */
export function actorCanDo(
  actor: ErpActor,
  permission: ErpPermission,
  deptId: string | null | undefined,
): boolean {
  return actorCan(actor, permission)
    && canActInDept(actor.profileRole, actor.myDeptId, deptId, actor.isDev);
}
