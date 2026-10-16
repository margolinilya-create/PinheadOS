/**
 * Навигация раздела «ТЗ» (Order Studio).
 *
 * Сейчас здесь только перенаправление старых адресов: канбан v3 (`/orders`),
 * аналитика продаж (`/analytics`) и печать v3 (`/print`) убраны, а закладки на
 * них у людей остались — они должны вести на рабочий экран, а не в пустоту.
 */

/** Роли, у которых есть список заказов v4 (`/sales`) */
const SALES_ROLES = ['admin', 'director']

/** Куда вести со старого адреса; неизвестный адрес — на визард */
export function legacyRedirect(path: string, role: string): string {
  if (path === '/orders' && SALES_ROLES.includes(role)) return '/sales'
  return '/'
}
