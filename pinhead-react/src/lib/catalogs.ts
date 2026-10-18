import { supabase } from './supabase';
import { sessionGet, sessionSet, sessionRemove } from './storage';
import { toast } from '../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../utils/i18n';

const CACHE_KEY = 'pinhead_catalogs_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

/**
 * Незавершённая загрузка: кэш пишется только ПОСЛЕ ответа, поэтому без этого
 * промиса-синглтона параллельные вызовы бьют в сеть каждый сам за себя.
 * Реально это происходило: loadCatalogs() зовётся и из main.jsx, и из
 * OrderStudioApp, а StrictMode дублирует эффекты — до 4 запросов на старте.
 */
let inFlight: Promise<Record<string, unknown>> | null = null;

/**
 * Загружает все каталоги из таблицы catalog_config в Supabase.
 * Использует sessionStorage кэш с TTL 30 минут.
 * Возвращает объект { key: value, ... }
 */
export function loadAllCatalogs(): Promise<Record<string, unknown>> {
  // Проверить кэш (sessionGet handles TTL expiry automatically)
  const cached = sessionGet<Record<string, unknown>>(CACHE_KEY);
  if (cached) return Promise.resolve(cached);

  if (!inFlight) {
    // finally, а не then: при ошибке повторный вызов должен снова пойти в сеть
    inFlight = fetchAllCatalogs().finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * Старые ключи `catalog_config` (веха 8, К7): их удаляет миграция M, а до неё
 * загрузчик их пропускает — код их не читает, и `prices` руководства не
 * подменяет `app_config.prices`, если тот не пришёл. Сторож — `catalogs.test.ts`
 */
export const LEGACY_CATALOG_CONFIG_KEYS: readonly string[] = ['prices', 'labels', 'extras', 'fabrics'];

async function fetchAllCatalogs(): Promise<Record<string, unknown>> {
  // Загрузить из Supabase (catalog_config + app_config). Флэты изделий
  // (`app_config.garmentFlats`, веха 5а) — не сюда: справочник тяжёлый, нужен
  // только вкладке «Дизайн», и та читает его сама (`fetchCatalogKey`)
  const [catalogRes, appRes] = await Promise.all([
    supabase.from('catalog_config').select('key, value'),
    supabase.from('app_config').select('key, value').neq('key', 'garmentFlats'),
  ]);
  if (catalogRes.error && appRes.error) throw catalogRes.error;
  if (catalogRes.error) console.warn('[loadAllCatalogs] catalog_config failed:', catalogRes.error.message);
  if (appRes.error) console.warn('[loadAllCatalogs] app_config failed:', appRes.error.message);

  const rows = [
    ...((catalogRes.data || []) as Array<{ key: string; value: unknown }>)
      .filter(r => !LEGACY_CATALOG_CONFIG_KEYS.includes(r.key)),
    ...((appRes.data || []) as Array<{ key: string; value: unknown }>),
  ];
  const raw: Record<string, unknown> = Object.fromEntries(
    rows.map(r => [r.key, r.value])
  );
  // Normalize keys: app_config uses 'sku_catalog', catalogSlice expects 'skuCatalog'
  // Priority: sku_catalog (app_config, canonical) > sku (legacy)
  const result: Record<string, unknown> = { ...raw };
  if (raw.sku_catalog) {
    result.skuCatalog = raw.sku_catalog;
  } else if (raw.sku && Array.isArray(raw.sku)) {
    result.skuCatalog = raw.sku;
  }

  // Warn about missing critical keys (catalogSlice falls back to defaults for these)
  const REQUIRED_KEYS = ['skuCatalog', 'fabricsCatalog', 'trimCatalog'] as const;
  for (const key of REQUIRED_KEYS) {
    if (!result[key]) console.warn(`[loadAllCatalogs] Missing required catalog key: ${key}`);
  }

  // Сохранить в кэш с TTL
  sessionSet(CACHE_KEY, result, CACHE_TTL);

  return result;
}

/**
 * Один справочник СВЕЖИМ запросом — мимо кэша `pinhead_catalogs_v1`
 * (веха 4). Нужен редакторам: значение отсюда становится базой для
 * `catalog_put` / `prices_patch`, и база из кэша получасовой давности
 * давала бы ложный конфликт, а то и правку поверх устаревшего.
 *
 * Ответ: `{ exists, value }` (строки нет — `exists: false`, `value: null`);
 * ошибка Supabase или сети — `toast.error` и `null`.
 */
export async function fetchCatalogKey(
  table: 'catalog_config' | 'app_config',
  key: string,
): Promise<{ exists: boolean; value: unknown } | null> {
  const fallback = 'Не удалось загрузить справочник';
  try {
    const { data, error } = await supabase
      .from(table)
      .select('key, value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.error('[fetchCatalogKey]', table, key, error);
      toast.error(translateSupabaseError(error.message) || fallback);
      return null;
    }
    const row = data as { key: string; value: unknown } | null;
    return row ? { exists: true, value: row.value } : { exists: false, value: null };
  } catch (e) {
    console.error('[fetchCatalogKey]', table, key, e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return null;
  }
}

/**
 * Очистить кэш каталогов.
 * Вызывать после сохранения цен / обновления каталогов.
 */
export function clearCatalogsCache(): void {
  sessionRemove(CACHE_KEY);
  inFlight = null;
}
