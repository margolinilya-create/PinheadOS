import { supabase } from './supabase';

const CACHE_KEY = 'pinhead_catalogs_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

/**
 * Загружает все каталоги из таблицы catalog_config в Supabase.
 * Использует sessionStorage кэш с TTL 30 минут.
 * Возвращает объект { key: value, ... }
 */
export async function loadAllCatalogs() {
  // Проверить кэш
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) {
        return data;
      }
    }
  } catch (e) {
    // sessionStorage недоступен — игнорируем
  }

  // Загрузить из Supabase
  const { data, error } = await supabase
    .from('catalog_config')
    .select('key, value');
  if (error) throw error;
  const result = Object.fromEntries(data.map(r => [r.key, r.value]));

  // Сохранить в кэш
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      data: result,
      ts: Date.now()
    }));
  } catch (e) {
    // Если sessionStorage переполнен — игнорируем
  }

  return result;
}

/**
 * Очистить кэш каталогов.
 * Вызывать после сохранения цен / обновления каталогов.
 */
export function clearCatalogsCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}
