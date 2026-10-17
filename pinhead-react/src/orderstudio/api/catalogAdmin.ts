/**
 * Запись справочников (веха 4, миграция G `…_order_catalogs`).
 *
 * ЕДИНСТВЕННЫЙ клиентский писатель `app_config`/`catalog_config` для новых
 * экранов. Обе RPC — `security definer` со своим гейтом и защитой от затирания:
 *   · `catalog_put(p_table, p_key, p_value, p_base)` — справочник целиком;
 *     сервер пишет только если в базе всё ещё `p_base` (равенство jsonb
 *     смысловое), `p_base = null` — строки ещё нет;
 *   · `prices_patch(p_patch, p_base)` — верхние ключи прайса со сверкой
 *     прежних значений тех же ключей.
 *
 * Отказ различается по виду — редактор решает по нему, что показать:
 *   · `conflict` (P0001) — справочник уже изменили (другая вкладка, другой
 *     администратор, ERP); кэш каталогов сброшен, правки остаются на экране;
 *   · `forbidden` (42501) — нет права;
 *   · `other` — форма записи (22023), сеть и прочее.
 * Каждая ошибка — `toast.error` с текстом сервера (он русский), правило проекта.
 */
import { supabase } from '../../lib/supabase';
import { clearCatalogsCache } from '../../lib/catalogs';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';

/** Пары «таблица → ключи», которые принимает `catalog_put` (белый список миграции G; `garmentFlats` — H, веха 5а, только admin и director) */
export const CATALOG_PUT_KEYS = {
  catalog_config: ['suppliers', 'fabricsCatalog', 'trimCatalog'],
  app_config: ['labelLibrary', 'tzSettings', 'sku_catalog', 'extrasCatalog', 'hardwareCatalog', 'categoryRules', 'zonesCatalog', 'garmentFlats'],
} as const;

/** Справочники заказа — их правит и руководитель продаж (rop) */
export const SALES_CATALOG_KEYS = {
  catalog_config: ['suppliers'],
  app_config: ['labelLibrary', 'tzSettings'],
} as const;

/** Ключи прайса, которые правит руководитель продаж (`prices_patch`) */
export const PRICE_RULE_KEYS = ['packOptions', 'prepFees', 'minMarginPct'] as const;

export type CatalogTable = keyof typeof CATALOG_PUT_KEYS;
export type CatalogKey<T extends CatalogTable> = (typeof CATALOG_PUT_KEYS)[T][number];

export type CatalogWriteResult =
  | { ok: true }
  | { ok: false; kind: 'conflict' | 'forbidden' | 'other'; message: string };

export const CONFLICT_MESSAGE = 'Справочник изменён — загрузите свежую версию';

interface RpcError {
  code?: string | null;
  message?: string | null;
}

function failure(fn: string, error: RpcError, fallback: string): CatalogWriteResult {
  console.error(fn, error);
  const kind = error.code === 'P0001' ? 'conflict' : error.code === '42501' ? 'forbidden' : 'other';
  const server = error.message ? translateSupabaseError(error.message) : '';
  const message = server || (kind === 'conflict' ? CONFLICT_MESSAGE : fallback);
  // Справочник ушёл вперёд — кэш каталогов устарел вместе с ним
  if (kind === 'conflict') clearCatalogsCache();
  toast.error(message);
  return { ok: false, kind, message };
}

async function callRpc(fn: string, args: Record<string, unknown>, fallback: string): Promise<CatalogWriteResult> {
  try {
    const { error } = await supabase.rpc(fn, args);
    if (error) return failure(fn, error as RpcError, fallback);
    clearCatalogsCache();
    return { ok: true };
  } catch (e) {
    console.error(fn, e);
    const message = `${fallback}: ${networkFailureMessage(e)}`;
    toast.error(message);
    return { ok: false, kind: 'other', message };
  }
}

/**
 * Записать справочник целиком. `base` — значение, с которого начиналась
 * правка (из свежего `fetchCatalogKey`); строки ещё нет — `null`.
 */
export function putCatalog<T extends CatalogTable>(
  table: T,
  key: CatalogKey<T>,
  value: unknown,
  base: unknown,
): Promise<CatalogWriteResult> {
  return callRpc('catalog_put', {
    p_table: table,
    p_key: key,
    p_value: value,
    p_base: base === undefined ? null : base,
  }, 'Не удалось сохранить справочник');
}

/**
 * Поправить верхние ключи прайса. `base` — прежние значения ТЕХ ЖЕ ключей;
 * ключа ещё нет — `undefined`/`null` (JSON не передаёт `undefined`, поэтому
 * он заменяется на `null` явно: иначе ключ пропал бы из сверки).
 */
export function patchPrices(
  patch: Record<string, unknown>,
  base: Record<string, unknown>,
): Promise<CatalogWriteResult> {
  const baseOut: Record<string, unknown> = {};
  for (const k of Object.keys(base)) baseOut[k] = base[k] === undefined ? null : base[k];
  return callRpc('prices_patch', { p_patch: patch, p_base: baseOut }, 'Не удалось сохранить правила цены');
}
