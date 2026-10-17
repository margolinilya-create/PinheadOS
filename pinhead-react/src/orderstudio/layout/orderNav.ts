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

export interface NavItem {
  to: string
  label: string
  /** Имя иконки из `erp/components/icons.js` */
  icon: string
  /** Роли учётной записи; без поля пункт виден всем */
  roles?: string[]
  /** Активен только на точном совпадении адреса (для `/`) */
  end?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const ORDER_NAV: NavGroup[] = [
  {
    title: 'Заказ',
    items: [
      { to: '/', label: 'Новый заказ', icon: 'plus', end: true },
      { to: '/sales', label: 'Заказы v4', icon: 'orders', roles: SALES_ROLES },
    ],
  },
  {
    title: 'Инструменты',
    items: [
      { to: '/express', label: 'Экспресс-расчёт', icon: 'tag', roles: ['admin', 'director', 'rop', 'manager'] },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/sku', label: 'Каталог', icon: 'shirt', roles: ['admin', 'director'] },
      { to: '/admin', label: 'Админка', icon: 'settings', roles: ['admin', 'director'] },
    ],
  },
]

/** Меню роли: пункты по `roles`, пустые группы выкинуты */
export function navFor(role: string): NavGroup[] {
  return ORDER_NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((g) => g.items.length > 0)
}
