import { supabase } from './supabase';
import { sessionGet, sessionSet, sessionRemove } from './storage';

const CACHE_KEY = 'pinhead_catalogs_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

/**
 * Загружает все каталоги из таблицы catalog_config в Supabase.
 * Использует sessionStorage кэш с TTL 30 минут.
 * Возвращает объект { key: value, ... }
 */
export async function loadAllCatalogs(): Promise<Record<string, unknown>> {
  // Проверить кэш (sessionGet handles TTL expiry automatically)
  const cached = sessionGet<Record<string, unknown>>(CACHE_KEY);
  if (cached) return cached;

  // Загрузить из Supabase (catalog_config + app_config)
  const [catalogRes, appRes] = await Promise.all([
    supabase.from('catalog_config').select('key, value'),
    supabase.from('app_config').select('key, value'),
  ]);
  if (catalogRes.error && appRes.error) throw catalogRes.error;

  const rows = [
    ...((catalogRes.data || []) as Array<{ key: string; value: unknown }>),
    ...((appRes.data || []) as Array<{ key: string; value: unknown }>),
  ];
  const raw: Record<string, unknown> = Object.fromEntries(
    rows.map(r => [r.key, r.value])
  );
  // Normalize keys: app_config uses 'sku_catalog', catalogSlice expects 'skuCatalog'
  const result: Record<string, unknown> = { ...raw };
  if (raw.sku_catalog && !raw.skuCatalog) result.skuCatalog = raw.sku_catalog;
  if (raw.sku && !raw.skuCatalog) result.skuCatalog = raw.sku;

  // Сохранить в кэш с TTL
  sessionSet(CACHE_KEY, result, CACHE_TTL);

  return result;
}

/**
 * Очистить кэш каталогов.
 * Вызывать после сохранения цен / обновления каталогов.
 */
export function clearCatalogsCache(): void {
  sessionRemove(CACHE_KEY);
}
