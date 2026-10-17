/**
 * Навигация и доступ раздела «ТЗ» (Order Studio).
 *
 * С вехи 3 раздел — это заказы v4: визарда v3 на `/` больше нет, `/` ведёт
 * в список. Кто сюда попадает, решает `canUseSales` — зеркало серверного
 * `sales_is_seller() or sales_is_lead()`; остальные переключаются
 * в «Производство» (`OrderStudioApp`).
 */

/** Профиль учётной записи — сколько нужно для доступа и меню */
export interface SalesProfile {
  role?: string | null;
  is_sales?: boolean | null;
  active?: boolean | null;
  approved?: boolean | null;
}

/** Руководство продаж (`sales_is_lead()`): видят все заказы */
const LEAD_ROLES = ['admin', 'director', 'rop'];
/** Настройки раздела: каталог, продавцы, админка */
const ADMIN_ROLES = ['admin', 'director'];

/** Профиль действующий: активный и одобренный — как в обеих серверных функциях (`is true`) */
function isLive(p: SalesProfile): boolean {
  return p.active === true && p.approved === true;
}

/** Руководство продаж: admin, director, rop */
export function isSalesLead(p: SalesProfile | null | undefined): boolean {
  return !!p && isLive(p) && LEAD_ROLES.includes(p.role ?? '');
}

/**
 * Работает ли человек с заказами v4. Зеркало `sales_is_seller() or
 * sales_is_lead()` (миграции 20261017062110, 20261017093841): продавец —
 * признак `is_sales` при любой роли, руководство — роль. Должность в ERP
 * и роль `manager` сами по себе доступа не дают.
 */
export function canUseSales(p: SalesProfile | null | undefined): boolean {
  if (!p || !isLive(p)) return false;
  return p.is_sales === true || LEAD_ROLES.includes(p.role ?? '');
}

/**
 * Старые адреса (канбан v3 `/orders`, аналитика, печать v3) — в список
 * заказов: закладки у людей остались, вести они должны на рабочий экран.
 */
export function legacyRedirect(_path: string): string {
  return '/sales';
}

/** Действие пункта меню вместо перехода: «Новый заказ» */
export const NEW_ORDER = 'new-order';

export interface NavItem {
  /** Адрес; у пункта-действия его нет */
  to?: string;
  /** Кнопка вместо ссылки (`NEW_ORDER`) */
  action?: typeof NEW_ORDER;
  label: string;
  /** Имя иконки из `erp/components/icons.js` */
  icon: string;
  /** Только admin/director */
  adminOnly?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Полное меню; подпись списка заказов зависит от роли — см. `ordersLabel` */
export const ORDER_NAV: NavGroup[] = [
  {
    title: 'Заказ',
    items: [
      { action: NEW_ORDER, label: 'Новый заказ', icon: 'plus' },
      { to: '/sales', label: 'Все заказы', icon: 'orders' },
    ],
  },
  {
    title: 'Инструменты',
    items: [
      { to: '/express', label: 'Экспресс', icon: 'tag' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/sku', label: 'Каталог', icon: 'shirt', adminOnly: true },
      { to: '/sales-staff', label: 'Менеджеры продаж', icon: 'users', adminOnly: true },
      { to: '/admin', label: 'Админка', icon: 'settings', adminOnly: true },
    ],
  },
];

/** Заголовок списка заказов и пункт меню: у каждого круга свой */
export function ordersLabel(p: SalesProfile | null | undefined): string {
  if (!isSalesLead(p)) return 'Мои заказы';
  return p?.role === 'rop' ? 'Заказы отдела' : 'Все заказы';
}

/** Меню профиля; без доступа к продажам — пустое (человек уходит в «Производство») */
export function navFor(p: SalesProfile | null | undefined): NavGroup[] {
  if (!canUseSales(p)) return [];
  const isAdmin = isSalesLead(p) && ADMIN_ROLES.includes(p?.role ?? '');
  return ORDER_NAV
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => !i.adminOnly || isAdmin)
        .map((i) => (i.to === '/sales' ? { ...i, label: ordersLabel(p) } : i)),
    }))
    .filter((g) => g.items.length > 0);
}
