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

  // Загрузить из Supabase
  const { data, error } = await supabase
    .from('catalog_config')
    .select('key, value');
  if (error) throw error;
  const result: Record<string, unknown> = Object.fromEntries(
    (data as Array<{ key: string; value: unknown }>).map(r => [r.key, r.value])
  );

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
