/**
 * Навигация и доступ раздела «ТЗ» (Order Studio).
 *
 * С вехи 3 раздел — это заказы v4: визарда v3 на `/` больше нет, `/` ведёт
 * в список. Кто сюда попадает, решает `canUseSales` — зеркало серверного
 * `sales_is_seller() or sales_is_lead() or sales_is_ms()`; остальные
 * переключаются в «Производство» (`OrderStudioApp`).
 */

import type { SalesOrderStatus } from '../model/types';

/** Профиль учётной записи — сколько нужно для доступа и меню */
export interface SalesProfile {
  /** `auth.uid()` — для гейтов «свой заказ» (автор, разделение обязанностей) */
  id?: string | null;
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

// ── Гейты отправки, оплаты и запуска (веха 6+7) ────────────────────────────
//
// Зеркало миграции J (`order_v4_transition`, `_launch_check`, `_set_payment`);
// сторож паритета — `orderV4Launch.test.ts` (задача 1). Гейт экрана —
// подсказка: окончательно решает сервер (права ERP `order.manage`/`tz.manage`
// МС, оплата, метка запуска), его отказ экран показывает текстом.

/** Заказ — сколько нужно гейтам */
export interface GateOrder {
  status: SalesOrderStatus;
  created_by?: string | null;
}

/** Руководство производства: admin, director (`v_boss` в J) */
const BOSS_ROLES = ['admin', 'director'];

/** МС (`sales_is_ms()`): активный, одобренный, признак `is_ms` */
export function isMs(p: SalesProfile | null | undefined): boolean {
  return !!p && isLive(p) && p.is_ms === true;
}

/** Руководство производства: admin, director */
export function isProductionBoss(p: SalesProfile | null | undefined): boolean {
  return !!p && isLive(p) && BOSS_ROLES.includes(p.role ?? '');
}

/** Автор заказа (К20): `sales_is_seller() and created_by = auth.uid()` — по признаку, а не по роли */
function isAuthor(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  return !!p && isLive(p) && p.is_sales === true && !!p.id && order.created_by === p.id;
}

/** МС или руководство производства — запуск, возврат, «сдан», очередь «К запуску» */
function isLauncher(p: SalesProfile | null | undefined): boolean {
  return isMs(p) || isProductionBoss(p);
}

/** «Отправить в работу»: черновик, автор (по `is_sales`) или руководство продаж */
export function canSendToWork(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  return order.status === 'draft' && (isSalesLead(p) || isAuthor(p, order));
}

/**
 * Отметка оплаты (К16): автор и руководство продаж — в `draft` и `ready_to_launch`;
 * МС — только в `ready_to_launch` и не на своём заказе. Право ERP `order.manage`
 * у МС проверяет сервер (отказ показывается текстом)
 */
export function canSetPayment(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  const open = order.status === 'draft' || order.status === 'ready_to_launch';
  if (open && (isSalesLead(p) || isAuthor(p, order))) return true;
  return order.status === 'ready_to_launch' && isMs(p) && !!p?.id && order.created_by !== p.id;
}

/** «Снять отметку» и «Разрешить запуск без оплаты» — только руководство продаж */
export function canSetPaymentOverride(p: SalesProfile | null | undefined): boolean {
  return isSalesLead(p);
}

/** «Запустить в производство»: ждёт запуска, МС или admin/director */
export function canLaunch(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  return order.status === 'ready_to_launch' && isLauncher(p);
}

/** «Вернуть менеджеру»: МС или admin/director; rop не возвращает (К17) */
export function canReturn(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  return order.status === 'ready_to_launch' && isLauncher(p);
}

/** «Отметить: заказ сдан»: в производстве, МС или admin/director */
export function canFinish(p: SalesProfile | null | undefined, order: GateOrder): boolean {
  return order.status === 'production' && isLauncher(p);
}

/** Пункт меню и пресет «К запуску»: МС или admin/director */
export function canSeeLaunchQueue(p: SalesProfile | null | undefined): boolean {
  return isLauncher(p);
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
  /** Кому пункт: admin/director, руководство продаж (сотрудники, справочники заказа), кто заводит заказы или МС и руководство производства («К запуску») */
  access?: 'admin' | 'lead' | 'create' | 'launch';
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Очередь «К запуску» — пресет списка заказов (веха 6+7, К22) */
export const LAUNCH_QUEUE_PATH = '/sales?status=ready_to_launch&sort=due';

/** Полное меню; подпись списка заказов зависит от роли — см. `ordersLabel` */
export const ORDER_NAV: NavGroup[] = [
  {
    title: 'Заказ',
    items: [
      { action: NEW_ORDER, label: 'Новый заказ', icon: 'plus', access: 'create' },
      { to: '/sales', label: 'Все заказы', icon: 'orders' },
      // Пресет списка (К22): ждут запуска, по сроку; строка ведёт на экран запуска
      { to: LAUNCH_QUEUE_PATH, label: 'К запуску', icon: 'play', access: 'launch' },
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
    launch: canSeeLaunchQueue(p),
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
