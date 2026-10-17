import { describe, it, expect } from 'vitest';
import { canUseSales, isSalesLead, legacyRedirect, navFor, ORDER_NAV, NEW_ORDER } from './orderNav';
import { ICONS } from '../../erp/components/icons';

type P = { role: string; is_sales?: boolean; active?: boolean; approved?: boolean };
const prof = (role: string, is_sales = false, extra: Partial<P> = {}): P =>
  ({ role, is_sales, active: true, approved: true, ...extra });

/**
 * Зеркало `sales_is_seller() or sales_is_lead()` (миграции 20261017062110,
 * 20261017093841): продавец — признак `is_sales`, руководство — роль
 * admin/director/rop; оба только у активного и одобренного профиля.
 */
describe('canUseSales — зеркало sales_is_seller() or sales_is_lead()', () => {
  it.each([
    ['admin', false, true],
    ['director', false, true],
    ['rop', false, true],
    ['manager', true, true],
    ['designer', true, true],
    ['production', true, true],
    ['manager', false, false],
    ['designer', false, false],
    ['production', false, false],
  ])('%s, is_sales=%s → %s', (role, isSales, expected) => {
    expect(canUseSales(prof(role, isSales))).toBe(expected);
  });

  it('неактивный или неодобренный профиль — нет, даже с признаком и ролью руководства', () => {
    expect(canUseSales(prof('manager', true, { active: false }))).toBe(false);
    expect(canUseSales(prof('admin', false, { approved: false }))).toBe(false);
  });

  it('нет профиля — нет', () => {
    expect(canUseSales(null)).toBe(false);
    expect(canUseSales(undefined)).toBe(false);
  });

  it('руководство продаж — admin, director, rop; продавец руководством не становится', () => {
    expect(['admin', 'director', 'rop'].every((r) => isSalesLead(prof(r)))).toBe(true);
    expect(isSalesLead(prof('manager', true))).toBe(false);
  });
});

describe('navFor — меню по профилю', () => {
  const labels = (p: P) => navFor(p).flatMap((g) => g.items.map((i) => i.label));

  it('продавец: «Новый заказ», «Мои заказы», «Экспресс»', () => {
    expect(labels(prof('manager', true))).toEqual(['Новый заказ', 'Мои заказы', 'Экспресс']);
  });

  it('rop: «Новый заказ», «Заказы отдела», «Экспресс»', () => {
    expect(labels(prof('rop'))).toEqual(['Новый заказ', 'Заказы отдела', 'Экспресс']);
  });

  it.each(['admin', 'director'])('%s: шесть пунктов', (role) => {
    expect(labels(prof(role))).toEqual([
      'Новый заказ', 'Все заказы', 'Экспресс', 'Каталог', 'Менеджеры продаж', 'Админка',
    ]);
  });

  it('руководство с признаком продавца видит меню руководства', () => {
    expect(labels(prof('rop', true))).toContain('Заказы отдела');
  });

  it('роль без продаж — меню пустое', () => {
    expect(navFor(prof('manager'))).toEqual([]);
    expect(navFor(null)).toEqual([]);
  });

  it('«Новый заказ» — действие (кнопка), а не ссылка; заказы ведут в /sales', () => {
    const items = navFor(prof('admin')).flatMap((g) => g.items);
    const fresh = items.find((i) => i.label === 'Новый заказ');
    expect(fresh?.action).toBe(NEW_ORDER);
    expect(fresh?.to).toBeUndefined();
    expect(items.find((i) => i.label === 'Все заказы')?.to).toBe('/sales');
  });

  it('пустые группы выкинуты', () => {
    expect(navFor(prof('manager', true)).every((g) => g.items.length > 0)).toBe(true);
  });

  it('иконка каждого пункта есть в наборе ERP', () => {
    for (const g of ORDER_NAV) for (const i of g.items) expect(ICONS).toHaveProperty(i.icon);
  });
});

describe('legacyRedirect — старые адреса ведут в список заказов', () => {
  it.each(['/orders', '/print', '/analytics', '/что-то'])('%s → /sales', (path) => {
    expect(legacyRedirect(path)).toBe('/sales');
  });
});
