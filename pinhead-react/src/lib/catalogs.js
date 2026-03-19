import { supabase } from './supabase';

/**
 * Загружает все каталоги из таблицы catalog_config в Supabase.
 * Возвращает объект { key: value, ... }
 */
export async function loadAllCatalogs() {
  const { data, error } = await supabase
    .from('catalog_config')
    .select('key, value');
  if (error) throw error;
  return Object.fromEntries(data.map(r => [r.key, r.value]));
}
