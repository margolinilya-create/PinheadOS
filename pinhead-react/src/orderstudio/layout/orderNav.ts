/**
 * Навигация и доступ раздела «ТЗ» (Order Studio).
 *
 * С вехи 3 раздел — это заказы v4: визарда v3 на `/` больше нет, `/` ведёт
 * в список. Кто сюда попадает, решает `canUseSales` — зеркало серверного
 * `sales_is_seller() or sales_is_lead() or sales_is_ms()`; остальные
 * переключаются в «Производство» (`OrderStudioApp`).
 */

/** Профиль учётной записи — сколько нужно для доступа и меню */
export interface SalesProfile {
  role?: string | null;
  is_sales?: boolean | null;
  /** МС: запускает заказы в производство (миграция F) */
  is_ms?: boolean | null;
  active?: boolean | null;
  approved?: boolean | null;
}

/** Руководство продаж (`sales_is_lead()`): видят все заказы */
const LEAD_ROLES = ['admin', 'director', 'rop'];
/** Настройки раздела: каталог и админка */
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
 * sales_is_lead() or sales_is_ms()` (миграции 20261017062110, 20261017093841,
 * 20261017142210): продавец — признак `is_sales`, МС — признак `is_ms` (оба
 * при любой роли), руководство — роль. Должность в ERP и роль `manager`
 * сами по себе доступа не дают.
 */
export function canUseSales(p: SalesProfile | null | undefined): boolean {
  if (!p || !isLive(p)) return false;
  return p.is_sales === true || p.is_ms === true || LEAD_ROLES.includes(p.role ?? '');
}

/**
 * Заводит ли свои заказы: продавец или руководство (`orders_insert`).
 * МС без признака продавца видит заказы в работе, своих не создаёт
 */
export function canCreateOrders(p: SalesProfile | null | undefined): boolean {
  if (!p || !isLive(p)) return false;
  return p.is_sales === true || LEAD_ROLES.includes(p.role ?? '');
}

/** Отмечает «Сотрудников продаж»: admin, director, rop — как `sales_set_staff` */
export function canManageSalesStaff(p: SalesProfile | null | undefined): boolean {
  return isSalesLead(p);
}

/**
 * Правит справочники заказа (`/order-settings`): admin, director, rop — как
 * `catalog_put`/`prices_patch` для ключей продаж (миграция G)
 */
export function canManageOrderCatalogs(p: SalesProfile | null | undefined): boolean {
  return isSalesLead(p);
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
  /** Кому пункт: admin/director, руководство продаж (сотрудники, справочники заказа) или кто заводит заказы */
  access?: 'admin' | 'lead' | 'create';
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
      { action: NEW_ORDER, label: 'Новый заказ', icon: 'plus', access: 'create' },
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
      { to: '/sku', label: 'Каталог моделей и цен', icon: 'shirt', access: 'admin' },
      { to: '/order-settings', label: 'Справочники заказа', icon: 'box', access: 'lead' },
      { to: '/sales-staff', label: 'Сотрудники продаж', icon: 'users', access: 'lead' },
      { to: '/admin', label: 'Админка', icon: 'settings', access: 'admin' },
    ],
  },
];

/** Заголовок списка заказов и пункт меню: у каждого круга свой */
export function ordersLabel(p: SalesProfile | null | undefined): string {
  if (!isSalesLead(p)) return canCreateOrders(p) ? 'Мои заказы' : 'Заказы в работе';
  return p?.role === 'rop' ? 'Заказы отдела' : 'Все заказы';
}

/** Меню профиля; без доступа к продажам — пустое (человек уходит в «Производство») */
export function navFor(p: SalesProfile | null | undefined): NavGroup[] {
  if (!canUseSales(p)) return [];
  const allowed: Record<NonNullable<NavItem['access']>, boolean> = {
    admin: isSalesLead(p) && ADMIN_ROLES.includes(p?.role ?? ''),
    lead: canManageSalesStaff(p),
    create: canCreateOrders(p),
  };
  return ORDER_NAV
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => !i.access || allowed[i.access])
        .map((i) => (i.to === '/sales' ? { ...i, label: ordersLabel(p) } : i)),
    }))
    .filter((g) => g.items.length > 0);
}
