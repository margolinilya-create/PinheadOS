import type { User } from '../types/auth';

/**
 * Подмена профиля dev-автологина (веха 8, задача 9, К12) — ТОЛЬКО для мока.
 *
 * Зачем. Dev-автологин даёт одного администратора, а обход «как живой
 * сотрудник» (смены `e2e/walk/*.spec.ts`, агент `pinhead-qa`) идёт по ролям:
 * продавец, МС, rop, дизайнер. Роль выбирается во время работы ключом
 * `localStorage['pinhead_dev_profile']`, а не переменной сборки: у Playwright
 * один dev-сервер на 5173, и четыре роли не требуют четырёх серверов.
 *
 * Три замка, чтобы это не доехало до людей:
 *   1. модуль подключает `useAuthStore` ДИНАМИЧЕСКИМ импортом под
 *      `if (import.meta.env.DEV)` — в прод-сборке ветка вырезается вместе
 *      с импортом, чанка `devProfiles` нет;
 *   2. ключ читается только в ветке dev-автологина, то есть когда настоящей
 *      сессии НЕТ (`npm run dev` против боевой базы с входом подмены не даёт);
 *   3. сторож `dist` (`scripts/bundle-budget-m8.mjs`, `checkNoDevProfiles`):
 *      в сборке нет маркера `__PINHEAD_DEV_PROFILES__`, ключа и чанка.
 *
 * Значение ключа прав не даёт: на моке права решает мок, на бою — RLS/RPC.
 * Профили — те же люди, что в фикстурах e2e (`orderCatalogFx.staffFx`,
 * `orderFlowFx.MS`), чтобы мок RPC и приложение называли одного человека.
 */

/** Ключ хранилища: `seller` | `ms` | `rop` | `designer` | `admin` */
export const DEV_PROFILE_KEY = 'pinhead_dev_profile';

/** Уникальная строка модуля: по ней сторож `dist` узнаёт, что модуль попал в сборку */
export const DEV_PROFILES_MARKER = '__PINHEAD_DEV_PROFILES__';

export type DevProfileName = 'seller' | 'ms' | 'rop' | 'designer' | 'admin';

const LIVE = { approved: true, active: true } as const;

export const DEV_PROFILES: Record<DevProfileName, User> = {
  seller: { id: 'p-maria', email: 'maria@pinhead.ru', name: 'Мария Кузнецова', role: 'manager', ...LIVE, is_sales: true, is_ms: false },
  ms: { id: 'p-ms', email: 'ms@pinhead.ru', name: 'Ирина МС', role: 'manager', ...LIVE, is_sales: false, is_ms: true },
  rop: { id: 'p-rop', email: 'rop@pinhead.ru', name: 'Роман Руководитель', role: 'rop', ...LIVE, is_sales: false, is_ms: false },
  designer: { id: 'p-dina', email: 'dina@pinhead.ru', name: 'Дина Дизайнер', role: 'designer', ...LIVE, is_sales: false, is_ms: false },
  // Тот же «Dev Mode», что без ключа: id `dev` держат проверки «настоящей сессии нет»
  admin: { id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode', role: 'admin', ...LIVE, is_sales: false, is_ms: false },
};

const isName = (v: string): v is DevProfileName => Object.prototype.hasOwnProperty.call(DEV_PROFILES, v);

/**
 * Профиль из `localStorage['pinhead_dev_profile']`; нет ключа, чужое значение
 * или хранилище недоступно — `null` (останется прежний dev-админ).
 */
export function devProfileFromStorage(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): User | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(DEV_PROFILE_KEY) ?? null;
  } catch {
    return null; // приватный режим, запрет хранилища
  }
  if (!raw) return null;
  if (!isName(raw)) {
    console.warn(`[auth] ${DEV_PROFILE_KEY}="${raw}" не профиль (${DEV_PROFILES_MARKER}): seller, ms, rop, designer, admin`);
    return null;
  }
  console.warn(`[auth] dev-профиль «${raw}» вместо dev-админа (${DEV_PROFILES_MARKER}) — только мок`);
  return { ...DEV_PROFILES[raw] };
}
