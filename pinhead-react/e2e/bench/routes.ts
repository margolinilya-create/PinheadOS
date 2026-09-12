/**
 * МАТРИЦА СОСТОЯНИЙ ДЛЯ ОБХОДА ГЛАЗАМИ — ОДИН СПИСОК НА ВЕСЬ СТЕНД.
 *
 * Не «список маршрутов»: половина состояний раздела адресом не исчерпывается.
 * Семь вкладок админки живут в `?tab=`, форма создания заказа — в `?new=1`,
 * очередь адресуется участком. Экран, состояние которого не попало сюда,
 * в обход не попадёт вовсе — а обход и есть способ увидеть дефект вёрстки.
 *
 * Сторож `src/erp/benchRoutes.test.ts` сверяет список с `<Route path=…>`
 * в `src/erp/ErpApp.jsx`: новый экран валит сторож, а не выпадает молча.
 * Тот же приём, что у витрины `/styleguide` — «списки берутся из данных,
 * а не вписываются руками».
 *
 * Идентификаторы — из фикстур `e2e/support/mockSupabase.ts`:
 *   ord-a  просрочен, шелкография в работе
 *   ord-b  срочный, закрой в работе + готовое к работе задание
 *   ord-b-i1-st1  этап закроя (страница задания)
 */

export type Shot = {
  /** Имя файла снимка: `<name>-<width>-<theme>.png` */
  name: string;
  /** Адрес внутри приложения; `?studio=0` добавляется автоматически */
  path: string;
  /** Маршрут из `ErpApp.jsx`, которому соответствует состояние (для сторожа) */
  route: string;
  /** Заголовок экрана — ждём его, а не сетевого простоя: `PageHead` рисует h1 внутри экрана */
  heading?: RegExp;
  /** Состояние, которого нет на узких ширинах (док прячет колонки) — снимать только шире */
  minWidth?: number;
};

export const SHOTS: Shot[] = [
  { name: 'dashboard', path: '/', route: '/', heading: /Обзор производства/ },

  { name: 'orders', path: '/orders', route: '/orders', heading: /^Заказы/ },
  { name: 'orders-archive', path: '/orders?tab=archive', route: '/orders' },
  { name: 'order-new', path: '/orders?new=1', route: '/orders' },
  { name: 'order-card', path: '/orders/ord-a', route: '/orders/:orderId' },
  { name: 'order-card-route', path: '/orders/ord-a?tab=route', route: '/orders/:orderId' },
  { name: 'order-card-materials', path: '/orders/ord-a?tab=materials', route: '/orders/:orderId' },
  { name: 'order-card-history', path: '/orders/ord-a?tab=history', route: '/orders/:orderId' },

  { name: 'board', path: '/board', route: '/board' },
  { name: 'plan', path: '/plan', route: '/plan' },
  { name: 'load', path: '/load', route: '/load' },
  { name: 'gantt', path: '/gantt', route: '/gantt' },

  { name: 'queue-cutting', path: '/queue/cutting', route: '/queue/:deptCode', heading: /Закройный цех/ },
  { name: 'queue-sewing', path: '/queue/sewing', route: '/queue/:deptCode' },
  { name: 'task', path: '/task/ord-b-i1-st1', route: '/task/:stageId' },

  { name: 'purchasing', path: '/purchasing', route: '/purchasing' },
  { name: 'purchase-list', path: '/orders/ord-a/purchase-list', route: '/orders/:orderId/purchase-list' },
  { name: 'warehouse', path: '/warehouse', route: '/warehouse' },
  { name: 'subcontracting', path: '/subcontracting', route: '/subcontracting' },
  { name: 'experimental', path: '/experimental', route: '/experimental' },
  { name: 'experimental-board', path: '/experimental?view=board', route: '/experimental' },

  { name: 'admin-users', path: '/admin?tab=users', route: '/admin' },
  { name: 'admin-roles', path: '/admin?tab=roles', route: '/admin' },
  { name: 'admin-depts', path: '/admin?tab=depts', route: '/admin' },
  { name: 'admin-dicts', path: '/admin?tab=dicts', route: '/admin' },
  { name: 'admin-capacity', path: '/admin?tab=capacity', route: '/admin' },
  { name: 'admin-bypass', path: '/admin?tab=bypass', route: '/admin' },
  { name: 'admin-studio', path: '/admin?tab=studio', route: '/admin' },

  { name: 'styleguide', path: '/styleguide?styleguide=1', route: '/styleguide' },
];

/**
 * Ширины обхода. 768 идёт с `hasTouch` — без него не срабатывает
 * `pointer: coarse`, а от него зависит ВСЯ компактная раскладка и правило
 * тач-целей ≥44px. Планшет цеха — основное рабочее устройство раздела,
 * и снимать его без касания значит снимать не тот интерфейс.
 */
export const WIDTHS = [
  { name: '1440', width: 1440, height: 900, hasTouch: false },
  { name: '768', width: 768, height: 1024, hasTouch: true },
  { name: '375', width: 375, height: 812, hasTouch: false },
] as const;

export const THEMES = ['light', 'dark'] as const;

/** Маршруты, которых в матрице нет намеренно — сторож читает этот список с причинами */
export const ROUTES_NOT_SHOT: Record<string, string> = {
  '/employees': 'редирект на /admin?tab=users — своего вида нет',
  '/departments': 'редирект на /admin?tab=depts — своего вида нет',
  '/experimental/:devId': 'в базовых фикстурах нет ни одной разработки: экран показал бы «не найдено»',
  '*': 'редирект на обзор',
};
