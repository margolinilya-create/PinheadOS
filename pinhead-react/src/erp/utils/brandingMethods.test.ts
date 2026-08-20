import { describe, expect, it } from 'vitest';
import {
  BRANDING_METHOD_LABELS,
  EMPLOYEE_ROLE_LABELS,
} from '../types';
import type { BrandingMethod } from '../types';
import { DEPARTMENTS, DEPT_ICONS, DEPT_SHORT_NAMES } from '../data/departments';
import { buildRoute } from './routes';
import { latestMatching, withoutComments } from './migrations.testutil';

/**
 * Сторож перечисления «метод нанесения» и роли участка.
 *
 * ЗАЧЕМ. Правило проекта записано после дефекта с `mixed`: перечисление,
 * расширенное в одной таблице, обязано быть расширено во ВСЕХ. Тогда значение
 * завели у `erp_subcontracting`, забыли в `erp_order_items` — и заказ
 * со смешанными материалами не создавался ВООБЩЕ (23514 на вставке позиции),
 * причём ни типы, ни тесты маршрута расхождения не видели: в клиенте
 * перечисление было одно.
 *
 * DTG (правки 20.08) — ровно тот же случай, только мест больше: метод
 * нанесения живёт в типе, в подписях, в карте «метод → цех», в CHECK
 * `erp_item_prints.method`; участок — в справочнике цехов, в его коротких
 * именах и иконках; роль участка — в CHECK `erp_employees.role`, в CHECK
 * `erp_invites.employee_role` и в колонках матрицы прав.
 *
 * Тест сверяет МНОЖЕСТВА, а не наличие конкретного значения: следующий метод
 * (условная «сублимация своим участком») попадёт под ту же проверку сам.
 */

const METHODS = Object.keys(BRANDING_METHOD_LABELS) as BrandingMethod[];

/** Методы, у которых СВОЙ участок: `other` делается внутри швейки, */
/** термоперенос принимает участок ДТФ — это не пробел, а решение маршрута. */
const METHODS_WITHOUT_OWN_DEPT = new Set<BrandingMethod>(['other', 'heat_transfer']);

/** CHECK метода нанесения — из последней миграции, которая его задаёт */
const PRINTS_CHECK = withoutComments(
  latestMatching(/erp_item_prints_method_check/, 'CHECK erp_item_prints.method'),
);

/** CHECK роли сотрудника и роли в приглашении */
const EMPLOYEE_ROLE_CHECK = withoutComments(
  latestMatching(/erp_employees_role_check/, 'CHECK erp_employees.role'),
);
const INVITE_ROLE_CHECK = withoutComments(
  latestMatching(/erp_invites_employee_role_check|employee_role\s+text not null check/,
    'CHECK erp_invites.employee_role'),
);

describe('перечисление методов нанесения', () => {
  it('каждый метод есть в CHECK erp_item_prints.method', () => {
    // Иначе позиция с этим нанесением не вставится — и уже ПОСЛЕ того,
    // как заказ-родитель создан: 23514 в середине транзакции создания
    for (const m of METHODS) {
      expect(PRINTS_CHECK, `метода ${m} нет в CHECK erp_item_prints`).toContain(`'${m}'`);
    }
  });

  it('у метода со своим участком этот участок есть в справочнике цехов', () => {
    const codes = new Set(DEPARTMENTS.map((d) => d.code));
    for (const m of METHODS) {
      if (METHODS_WITHOUT_OWN_DEPT.has(m)) continue;
      expect(codes, `нет участка под метод ${m}`).toContain(m);
    }
  });

  it('метод со своим участком попадает в маршрут именно на него', () => {
    // BRANDING_DEPT не экспортируется — проверяем через сам расчёт маршрута:
    // забытая строка карты дала бы позицию без участка нанесения ВООБЩЕ
    for (const m of METHODS) {
      if (METHODS_WITHOUT_OWN_DEPT.has(m)) continue;
      const route = buildRoute({
        productionType: 'sewing',
        brandingMethods: [m],
        brandingOn: 'cut',
      });
      expect(
        route.map((r) => r.departmentCode),
        `маршрут с нанесением ${m} не содержит его участка`,
      ).toContain(m);
    }
  });

  it('участок нанесения имеет короткое имя и иконку', () => {
    for (const d of DEPARTMENTS.filter((x) => x.is_branding)) {
      expect(DEPT_SHORT_NAMES[d.code], `нет короткого имени: ${d.code}`).toBeTruthy();
      expect(DEPT_ICONS[d.code], `нет иконки: ${d.code}`).toBeTruthy();
    }
  });
});

describe('роли участков', () => {
  it('у каждого участка нанесения есть одноимённая роль', () => {
    // Заказчик перечислил участки самостоятельными ролями команды (10.08):
    // человек заводится с ролью участка, а различает их привязка к цеху
    const roles = Object.keys(EMPLOYEE_ROLE_LABELS);
    for (const d of DEPARTMENTS.filter((x) => x.is_branding)) {
      expect(roles, `нет роли под участок ${d.code}`).toContain(d.code);
    }
  });

  it('каждая роль есть в CHECK приглашения', () => {
    // Роль без строки в этом CHECK означает «позвать человека на участок
    // нельзя»: приглашение упадёт 23514 в момент выписки ссылки
    for (const role of Object.keys(EMPLOYEE_ROLE_LABELS)) {
      expect(INVITE_ROLE_CHECK, `роли ${role} нет в CHECK erp_invites`).toContain(`'${role}'`);
    }
  });

  it('каждая роль есть в CHECK сотрудника', () => {
    for (const role of Object.keys(EMPLOYEE_ROLE_LABELS)) {
      expect(EMPLOYEE_ROLE_CHECK, `роли ${role} нет в CHECK erp_employees`).toContain(`'${role}'`);
    }
  });
});
