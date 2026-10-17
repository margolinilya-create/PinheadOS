import { describe, it, expect } from 'vitest';
import {
  canCreateOrders, canManageOrderCatalogs, canManageSalesStaff, canUseSales, isSalesLead, legacyRedirect, navFor, ordersLabel,
  ORDER_NAV, NEW_ORDER,
} from './orderNav';
import { ICONS } from '../../erp/components/icons';

type P = { role: string; is_sales?: boolean; is_ms?: boolean; active?: boolean; approved?: boolean };
const prof = (role: string, is_sales = false, extra: Partial<P> = {}): P =>
  ({ role, is_sales, active: true, approved: true, ...extra });

/** МС без признака продавца (миграция F) */
const ms = (role = 'manager', extra: Partial<P> = {}): P => prof(role, false, { is_ms: true, ...extra });

/**
 * Зеркало `sales_is_seller() or sales_is_lead() or sales_is_ms()` (миграции
 * 20261017062110, 20261017093841, 20261017142210): продавец — признак `is_sales`,
 * МС — признак `is_ms`, руководство — роль admin/director/rop; всё только
 * у активного и одобренного профиля.
 */
describe('canUseSales — зеркало sales_is_seller() or sales_is_lead() or sales_is_ms()', () => {
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

  it.each(['manager', 'designer', 'production'])('МС (%s, is_ms) без признака продавца — входит', (role) => {
    expect(canUseSales(ms(role))).toBe(true);
  });

  it('МС отключён или не одобрен — нет', () => {
    expect(canUseSales(ms('manager', { active: false }))).toBe(false);
    expect(canUseSales(ms('manager', { approved: false }))).toBe(false);
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

  it('rop: «Новый заказ», «Заказы отдела», «Экспресс», «Справочники заказа», «Сотрудники продаж»', () => {
    expect(labels(prof('rop'))).toEqual([
      'Новый заказ', 'Заказы отдела', 'Экспресс', 'Справочники заказа', 'Сотрудники продаж',
    ]);
  });

  it.each(['admin', 'director'])('%s: семь пунктов', (role) => {
    expect(labels(prof(role))).toEqual([
      'Новый заказ', 'Все заказы', 'Экспресс', 'Каталог моделей и цен', 'Справочники заказа',
      'Сотрудники продаж', 'Админка',
    ]);
  });

  it('«Справочники заказа» ведут на /order-settings; продавцу и МС пункта нет', () => {
    const item = navFor(prof('rop')).flatMap((g) => g.items).find((i) => i.label === 'Справочники заказа');
    expect(item?.to).toBe('/order-settings');
    expect(labels(prof('manager', true))).not.toContain('Справочники заказа');
    expect(labels(ms())).not.toContain('Справочники заказа');
  });

  it('МС без признака продавца: «Заказы в работе» и «Экспресс», без «Нового заказа»', () => {
    expect(labels(ms())).toEqual(['Заказы в работе', 'Экспресс']);
  });

  it('МС с признаком продавца — меню продавца', () => {
    expect(labels(prof('manager', true, { is_ms: true }))).toEqual(['Новый заказ', 'Мои заказы', 'Экспресс']);
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

describe('кто заводит заказы и отмечает сотрудников', () => {
  it('canCreateOrders — продавец и руководство; МС без признака продавца — нет', () => {
    expect(canCreateOrders(prof('manager', true))).toBe(true);
    expect(canCreateOrders(prof('rop'))).toBe(true);
    expect(canCreateOrders(ms())).toBe(false);
    expect(canCreateOrders(prof('manager', true, { active: false }))).toBe(false);
    expect(canCreateOrders(null)).toBe(false);
  });

  it('canManageSalesStaff — admin, director, rop (как sales_set_staff); продавец и МС — нет', () => {
    expect(['admin', 'director', 'rop'].every((r) => canManageSalesStaff(prof(r)))).toBe(true);
    expect(canManageSalesStaff(prof('manager', true))).toBe(false);
    expect(canManageSalesStaff(ms())).toBe(false);
    expect(canManageSalesStaff(prof('rop', false, { approved: false }))).toBe(false);
  });

  it('ordersLabel: продавец — «Мои заказы», МС — «Заказы в работе»', () => {
    expect(ordersLabel(prof('manager', true))).toBe('Мои заказы');
    expect(ordersLabel(ms())).toBe('Заказы в работе');
  });
});

describe('legacyRedirect — старые адреса ведут в список заказов', () => {
  it.each(['/orders', '/print', '/analytics', '/что-то'])('%s → /sales', (path) => {
    expect(legacyRedirect(path)).toBe('/sales');
  });
});

describe('canManageOrderCatalogs — справочники заказа', () => {
  it('admin, director, rop — да; продавец, МС, отключённый — нет', () => {
    expect(['admin', 'director', 'rop'].every((r) => canManageOrderCatalogs(prof(r)))).toBe(true);
    expect(canManageOrderCatalogs(prof('manager', true))).toBe(false);
    expect(canManageOrderCatalogs(ms())).toBe(false);
    expect(canManageOrderCatalogs(prof('rop', false, { active: false }))).toBe(false);
    expect(canManageOrderCatalogs(null)).toBe(false);
  });
});
