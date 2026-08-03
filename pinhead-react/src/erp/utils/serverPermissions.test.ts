import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PERMISSIONS, resolveErpRole } from './permissions';
import { ERP_PERMISSIONS } from '../types';

/**
 * Матрица прав применяется в ДВУХ местах: в React (`resolveErpRole` + `isAllowed`)
 * и на сервере (`erp_role_of_caller()` + `erp_has_permission()` в миграции
 * 20260803160000). Расхождение этих реализаций даёт худший вид отказа —
 * «в интерфейсе кнопка есть, а сервер отвечает 42501», и виноватым выглядит цех.
 *
 * Тест читает саму миграцию: SQL из vitest не выполнить, но проверить, что правила
 * резолюции роли записаны одинаково, можно — как сторожевой тест APP_KEYS,
 * который так же читает исходники.
 */

const SQL = readFileSync(
  join(process.cwd(), '../supabase/migrations/20260803160000_erp_permissions_server_side.sql'),
  'utf8',
);

describe('серверная резолюция роли повторяет клиентскую', () => {
  it('admin и director профиля приводятся к цеховой роли director', () => {
    expect(resolveErpRole('admin', 'worker')).toBe('director');
    expect(resolveErpRole('director', null)).toBe('director');
    expect(SQL).toMatch(/in \('admin', 'director'\) then 'director'/);
  });

  it('таблица соответствия ролей Order Studio совпадает с SQL', () => {
    const pairs: [string, string][] = [
      ['rop', 'dispatcher'],
      ['manager', 'manager'],
      ['production', 'worker'],
      ['designer', 'worker'],
    ];
    for (const [profileRole, erpRole] of pairs) {
      // Клиент
      expect(resolveErpRole(profileRole, null)).toBe(erpRole);
      // Сервер: та же пара записана в CASE
      expect(SQL).toMatch(new RegExp(`when '${profileRole}' then '${erpRole}'`));
    }
  });

  it('роль из erp_employees важнее таблицы соответствия', () => {
    expect(resolveErpRole('manager', 'foreman')).toBe('foreman');
    expect(SQL).toMatch(/employee_role from me\) is not null then/);
  });

  it('сервер берёт роль только у активного и одобренного профиля', () => {
    // Иначе неодобренный пользователь получил бы права рядового сотрудника цеха
    expect(SQL).toMatch(/p\.active is true and p\.approved is true/);
    expect(SQL).toMatch(/e\.active is true/);
  });
});

describe('серверный гейт плана', () => {
  it('отсутствие права в матрице означает запрет, а не дефолт', () => {
    // На клиенте пустая матрица падает на DEFAULT_PERMISSIONS — это защита от
    // неудачной загрузки. На сервере таблица засеяна миграциями целиком.
    expect(SQL).toMatch(/coalesce\(\(\s*select rp\.allowed/);
    expect(SQL).toMatch(/\), false\)/);
  });

  it('ставить и снимать задачи вправе только plan.manage', () => {
    expect(SQL).toMatch(/erp_calendar_slots_insert[\s\S]*plan\.manage/);
    expect(SQL).toMatch(/снятие задачи из плана требует права plan\.manage/);
  });

  it('страж перечисляет ВСЕ плановые колонки — иначе plan.fact правит план', () => {
    for (const col of [
      'department_id', 'stage_id', 'work_date', 'qty_planned',
      'priority', 'sort_order', 'comment', 'created_by',
    ]) {
      expect(SQL).toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
  });

  it('колонки факта и проблемы в стража НЕ входят — их вносит цех', () => {
    for (const col of ['qty_done', 'qty_defect', 'fact_comment', 'deviation_reason', 'problem_type']) {
      expect(SQL).not.toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
  });

  it('права плана заведены в матрице прав приложения', () => {
    expect(ERP_PERMISSIONS).toContain('plan.manage');
    expect(ERP_PERMISSIONS).toContain('plan.fact');
    expect(DEFAULT_PERMISSIONS.production_head).toContain('plan.manage');
  });
});
