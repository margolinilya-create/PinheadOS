import { describe, expect, it } from 'vitest';
import { landingPathForRole } from './landing';
import { DEPT_BOUND_ROLES } from './permissions';
import { EMPLOYEE_ROLE_LABELS } from '../types';
import type { EmployeeRole } from '../types';

/**
 * Очередь адресуется УЧАСТКОМ (правки 07.09, п. 18): код приходит снаружи —
 * его считает `utils/myDept`, у которого свои тесты. Здесь проверяется правило
 * «какой роли куда», а не «чей участок свой».
 */
const ALL_OPEN = { canOpen: () => true, deptCode: 'cutting' };
const NONE_OPEN = { canOpen: () => false, deptCode: 'cutting' };

describe('посадочная по роли', () => {
  it('цеховые роли открывают свою очередь, а не сводку по фабрике', () => {
    // Роли `dtg` больше нет: участок снят правками 07.09 (п. 17), носителей
    // на боевой базе не было, значение убрано из CHECK `erp_employees.role`
    for (const role of ['worker', 'foreman', 'dtf', 'silkscreen', 'embroidery'] as EmployeeRole[]) {
      expect(landingPathForRole(role, ALL_OPEN), role).toBe('/queue/cutting');
    }
  });

  it('у кладовщика, закупщика и технолога своя поверхность', () => {
    expect(landingPathForRole('storekeeper', ALL_OPEN)).toBe('/warehouse');
    expect(landingPathForRole('purchaser', ALL_OPEN)).toBe('/purchasing');
    expect(landingPathForRole('technologist', ALL_OPEN)).toBe('/experimental');
  });

  /**
   * Кладовщик и закупщик стоят в `DEPT_BOUND_ROLES`, то есть привязаны
   * к участку, — но работают не в очереди. Проверка своей поверхности обязана
   * идти ПЕРВОЙ, иначе оба уедут в очередь цеха.
   */
  it('привязка к участку не уводит кладовщика и закупщика в очередь', () => {
    expect(DEPT_BOUND_ROLES).toContain('storekeeper');
    expect(DEPT_BOUND_ROLES).toContain('purchaser');
    expect(landingPathForRole('storekeeper', ALL_OPEN)).toBe('/warehouse');
    expect(landingPathForRole('purchaser', ALL_OPEN)).toBe('/purchasing');
  });

  it('руководящие роли остаются на обзоре', () => {
    for (const role of ['manager', 'dispatcher', 'production_head', 'director', 'hr'] as EmployeeRole[]) {
      expect(landingPathForRole(role, ALL_OPEN), role).toBeNull();
    }
  });

  /**
   * Новичок без должности не имеет ни одного права. Отправить его в цех —
   * значит встретить экраном «Нет доступа» вместо объяснения, что должность
   * ещё не назначена.
   */
  it('роль без прав остаётся на обзоре', () => {
    expect(landingPathForRole('pending', ALL_OPEN)).toBeNull();
  });

  /**
   * Посадочная СПРАШИВАЕТ гейт разделов, а не выдаёт доступ: раздел, закрытый
   * правом, целевым экраном всё равно не откроется — человек увидит «Нет
   * доступа» вместо своей работы, и виноватым будет выглядеть вход в систему.
   */
  it('закрытый правом раздел не становится посадочной', () => {
    expect(landingPathForRole('storekeeper', NONE_OPEN)).toBeNull();
    expect(landingPathForRole('purchaser', NONE_OPEN)).toBeNull();
    expect(landingPathForRole('technologist', NONE_OPEN)).toBeNull();
  });

  /**
   * Очередь цеха гейта разделов не имеет вовсе (`SCREEN_ACCESS` её не
   * перечисляет) — она открыта всем, и цеховой роли там всегда есть что делать.
   */
  it('очередь цеха не зависит от гейта разделов', () => {
    expect(landingPathForRole('worker', NONE_OPEN)).toBe('/queue/cutting');
  });

  /**
   * Участка нет — вести некуда, и это ОТДЕЛЬНЫЙ ответ, а не `/queue` без кода:
   * такого адреса больше не существует, а `/queue/undefined` открыл бы страницу
   * несуществующего цеха. Человек остаётся на обзоре, где `DeptBindingNotice`
   * объясняет, что заведение сотрудника не закончено.
   */
  it('цеховая роль без известного участка остаётся на обзоре', () => {
    expect(landingPathForRole('worker', { canOpen: () => true })).toBeNull();
    expect(landingPathForRole('worker', { canOpen: () => true, deptCode: '' })).toBeNull();
  });

  /** Новая роль обязана получить ответ, а не молча уехать на обзор по умолчанию */
  it('каждая заведённая роль разобрана явно или осознанно оставлена на обзоре', () => {
    const roles = Object.keys(EMPLOYEE_ROLE_LABELS) as EmployeeRole[];
    const onDashboard = roles.filter((r) => landingPathForRole(r, ALL_OPEN) === null);
    expect(onDashboard.sort()).toEqual(
      ['director', 'dispatcher', 'hr', 'manager', 'pending', 'production_head'].sort(),
    );
  });
});
