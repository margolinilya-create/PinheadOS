/**
 * Какую оболочку открыть: «Оформление заказа» (`order`) или «Производство» (`erp`).
 *
 * Чистая функция, один вызывающий — `ShellGate` в `App.jsx`: решение
 * принимается ОДИН раз за загрузку страницы для данного `user.id`
 * (веха 8, решение К1). Пересчёт по пути на ходу размонтировал бы раздел
 * посреди работы (автосохранение, буфер позиции, состояния сохранения).
 *
 * Порядок правил — первый сработавший решает:
 *  1. аварийный выключатель: `env` = `'0'`/`'false'` → `erp` всем; `?studio=1`
 *     его НЕ обходит (такие ссылки живут в закладках и письмах);
 *  2. `?studio=1|0` в адресе — на один заход;
 *  3. путь только раздела заказа (`/sales…`, `/sales-staff`, `/order-settings`,
 *     `/express`, `/sku`, `/prices`) и `canUseSales` → `order`: F5 на `/sales/:id`
 *     остаётся в разделе без флага;
 *  4. явный выбор устройства (`pinhead_feature_orderStudio`): `'1'` — кнопка
 *     «в ТЗ» у admin/director; `'0'` — `LeaveToProduction` (профиль без доступа)
 *     и кнопка «в Производство» у admin/director. Продавцу, МС и rop `'0'`
 *     никто из них не пишет — для них записанный кем-то `'0'` пропускается,
 *     иначе запер бы человека в «Производстве» (кнопки обратно там нет);
 *  5. умолчание профиля: `canUseSales` и роль не admin/director → `order`;
 *  6. `env` = `'1'`/`'true'` (dev и e2e) → `order`;
 *  7. `erp`.
 *
 * Оболочка — только интерфейс: права на сервере не зависят от неё (RLS, RPC).
 */
import { canUseSales, type SalesProfile } from '../orderstudio/layout/salesAccess';

export type Shell = 'order' | 'erp';

/**
 * Значение `VITE_FEATURE_ORDER_STUDIO` — тройка:
 *  - `'0'` / `'false'` — аварийный выключатель (интерфейс раздела гаснет у всех);
 *  - `'1'` / `'true'` — dev и e2e: раздел по умолчанию, если профиль не решил иначе;
 *  - пусто (не задано) — по профилю.
 */
export type ShellEnv = 'off' | 'on' | 'profile';

export interface ShellInput {
  /** `location.search` */
  search: string;
  /** `location.pathname` */
  path: string;
  /** Сырое значение `localStorage['pinhead_feature_orderStudio']` */
  stored: string | null;
  /** Сырое значение `VITE_FEATURE_ORDER_STUDIO` */
  env: string | null | undefined;
  profile: SalesProfile | null | undefined;
}

/** Пути, которые есть только у раздела заказа */
const ORDER_ONLY_PATHS = ['/sales', '/sales-staff', '/order-settings', '/express', '/sku', '/prices'];

/** Роли, которых умолчание оставляет в «Производстве» */
const PRODUCTION_FIRST_ROLES = ['admin', 'director'];

export function shellEnv(raw: string | null | undefined): ShellEnv {
  if (raw === '0' || raw === 'false') return 'off';
  if (raw === '1' || raw === 'true') return 'on';
  return 'profile';
}

export function isOrderOnlyPath(path: string): boolean {
  return ORDER_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Продавец, МС или rop: доступ к заказам есть, «Производство» — не их дом */
export function isSalesFirst(profile: SalesProfile | null | undefined): boolean {
  return canUseSales(profile) && !PRODUCTION_FIRST_ROLES.includes(profile?.role ?? '');
}

function fromUrl(search: string): Shell | null {
  let v: string | null = null;
  try {
    v = new URLSearchParams(search).get('studio');
  } catch {
    return null;
  }
  if (v === '1' || v === 'true') return 'order';
  if (v === '0' || v === 'false') return 'erp';
  return null;
}

export function chooseShell({ search, path, stored, env, profile }: ShellInput): Shell {
  const mode = shellEnv(env);
  if (mode === 'off') return 'erp';

  const url = fromUrl(search);
  if (url) return url;

  if (isOrderOnlyPath(path) && canUseSales(profile)) return 'order';

  if (stored === '1' || stored === 'true') return 'order';
  if ((stored === '0' || stored === 'false') && !isSalesFirst(profile)) return 'erp';

  if (isSalesFirst(profile)) return 'order';
  if (mode === 'on') return 'order';
  return 'erp';
}
