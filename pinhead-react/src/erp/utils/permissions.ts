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
   * Руководитель производства ведёт план и всю диспетчеризацию, кроме справочников.
   * Аварийное снятие блокировок (`bypass.manage`) сюда НЕ входит: оно затрагивает
   * всё производство разом, поэтому по умолчанию остаётся у директора. Раздать
   * шире — галочкой в матрице, на то она и есть.
   */
  production_head: ERP_PERMISSIONS.filter((p) => p !== 'catalog.edit' && p !== 'bypass.manage'),
  // Диспетчер план НЕ ставит — за это отвечает руководитель производства
  dispatcher: ERP_PERMISSIONS.filter(
    (p) => p !== 'catalog.edit' && p !== 'plan.manage' && p !== 'bypass.manage',
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
  // tz.manage приходит из отдельной миграции (волна 4) — в seed менеджер его имеет,
  // и без него менеджер молча терял бы возможность вести ТЗ, если матрица не загрузилась
  manager: ['stage.block', 'stage.priority', 'order.manage', 'tz.manage'],
  // material.receive (волна 2 правок менеджера): приёмка — работа закупки и склада
  purchaser: ['stage.block', 'material.receive'],
  storekeeper: ['stage.block', 'material.receive'],
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
