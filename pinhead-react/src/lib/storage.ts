/* ── Centralized storage utilities ── */

import { supabase } from './supabase';

// ── localStorage ──

export function storageGet<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * СЫРАЯ строка без `JSON.parse` — и это не дубль `storageGet`.
 *
 * Половина ключей ERP хранит именно строки: `'1'`/`'0'` у свёрнутого сайдбара,
 * `'queue'`/`'plan'` у вида кабинета цеха, код участка у выбранного цеха.
 * `storageGet` разбирает значение как JSON, и на `queue` он бросает, молча
 * возвращая дефолт — то есть прямая замена одного на другой сломала бы
 * запомненные настройки, ничего об этом не сказав.
 *
 * Заведено аудитом 03.09: до него интерфейс ходил в `localStorage` напрямую,
 * без try/catch, тогда как стор свои обращения защищал. Обращение в теле
 * компонента (`ErpLayout` читает свёрнутость в инициализаторе `useState`)
 * исполняется при ОТРИСОВКЕ, и запрет доступа к хранилищу — приватный режим,
 * политика устройства, переполнение — ронял всю оболочку белым экраном.
 */
export function storageGetRaw(key: string, defaultValue: string | null = null): string | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : raw;
  } catch {
    return defaultValue;
  }
}

/** Записать сырую строку (пара к `storageGetRaw`) */
export function storageSetRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим или переполнение — настройка живёт до перезагрузки
  }
}

export function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}

// ── Clear all app data (on logout) ──

/**
 * Ключи, которые чистятся при выходе. Список ведётся руками, поэтому его
 * полноту сторожит тест (`storage.test.ts`): он собирает ключи из исходников и
 * падает, если появился новый, не попавший ни сюда, ни в KEEP_ON_LOGOUT.
 * Так `erp_order_draft` и был найден — черновик заказа с заказчиком и тиражом
 * переживал смену пользователя на общем цеховом планшете.
 */
export const APP_KEYS = [
  // Черновики: содержат данные клиента (заказчик, тираж, параметры нанесения)
  'pinhead_draft',
  'erp_order_draft',
  // Выбранный цех ERP: на общем цеховом планшете он переживал выход из системы,
  // и следующий рабочий попадал в чужой цех, не заметив этого
  'erp_my_dept',
  // Кэш каталогов и цен — данные организации, а не устройства
  'ph_prices',
  'ph_price_history',
  'ph_cb_rate',
  'ph_extras',
  'ph_hardware',
  'ph_sku',
  'ph_fabrics',
  'ph_trims',
  'ph_usd_rate',
  'ph_category_rules',
  'ph_zones',
  // Подсказки новичку — состояние конкретного человека, не устройства
  'ph_onboarding_done',
  // Показ тестовых заказов: отладочный режим, доступный только admin/director.
  // Настройка человека, а не устройства — по той же причине, что и `erp_my_dept`:
  // на общем цеховом планшете иначе следующая смена получила бы список,
  // разбавленный тестовыми заказами, и считала бы по нему сроки.
  'erp_show_demo',
];

/**
 * Ключи, которые выход НЕ трогает — настройки устройства, а не пользователя.
 * Тема и раскладка планшета не должны сбрасываться от того, что сменилась смена.
 */
export const KEEP_ON_LOGOUT = [
  'ph_theme',
  'erp_board_view',
  // Вид «Мой цех»: очередь или план. Настройка устройства, а не человека —
  // цех обычно работает в одном и том же виде смену за сменой
  'erp_queue_view',
  'erp_sidebar_collapsed',
  /*
   * Сколько строк резервировать под меню цехов, пока не приехал `erp_bootstrap`.
   *
   * Раскладка УСТРОЙСТВА, а не человека: это одно целое число, оно ничего
   * не открывает и никуда не маршрутизирует (в отличие от `erp_my_dept`,
   * который увозил бы рабочего в чужой цех и потому чистится). Состав меню
   * по-прежнему целиком из `erp_departments` — запомнена только высота места.
   *
   * Именно KEEP_ON_LOGOUT, а не APP_KEYS: на общем цеховом планшете смена
   * логинится заново каждый день, и в APP_KEYS резерв обнулялся бы перед
   * каждой первой загрузкой — то есть починка была бы мёртвой ровно там,
   * ради чего делалась.
   */
  'erp_dept_rows',
];

export function storageClearAll(): void {
  for (const key of APP_KEYS) {
    storageRemove(key);
  }
  // sessionStorage: кэш каталогов живёт до конца вкладки, а вкладка на общем
  // планшете переживает смену пользователя
  sessionRemove('pinhead_catalogs_v1');
}

// ── sessionStorage ──

interface SessionEnvelope<T = unknown> {
  value: T;
  expires: number | null;
}

export function sessionGet<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return defaultValue;
    const parsed = JSON.parse(raw);
    // Check TTL envelope
    if (parsed && typeof parsed === 'object' && 'value' in parsed && 'expires' in parsed) {
      const envelope = parsed as SessionEnvelope<T>;
      if (envelope.expires !== null && Date.now() > envelope.expires) {
        sessionStorage.removeItem(key);
        return defaultValue;
      }
      return envelope.value;
    }
    return parsed as T;
  } catch {
    return defaultValue;
  }
}

export function sessionSet(key: string, value: unknown, ttlMs: number | null = null): void {
  try {
    const envelope: SessionEnvelope = {
      value,
      expires: ttlMs !== null ? Date.now() + ttlMs : null,
    };
    sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}

// ── Supabase Storage: SKU photos ──

const SKU_BUCKET = 'sku-photos';

let _bucketChecked = false;
async function ensureBucket(): Promise<void> {
  if (_bucketChecked) return;
  _bucketChecked = true;
  const { data } = await supabase.storage.getBucket(SKU_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(SKU_BUCKET, { public: true });
  }
}

export async function uploadSkuPhoto(code: string, file: File, index: number = 0): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${code}_${index}.${ext}`;

  await ensureBucket();

  const { error } = await supabase.storage.from(SKU_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    console.error('[uploadSkuPhoto]', error.message);
    return null;
  }

  const { data } = supabase.storage.from(SKU_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function getSkuPhotoUrl(path: string): string {
  const { data } = supabase.storage.from(SKU_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteSkuPhotoByUrl(url: string): Promise<boolean> {
  const match = url.match(/sku-photos\/(.+)$/);
  if (!match) return false;
  const { error } = await supabase.storage.from(SKU_BUCKET).remove([match[1]]);
  if (error) {
    console.error('[deleteSkuPhotoByUrl]', error.message);
    return false;
  }
  return true;
}

export async function deleteSkuPhoto(code: string): Promise<void> {
  const exts = ['jpg', 'jpeg', 'png', 'webp'];
  const paths: string[] = [];
  for (let i = 0; i < 4; i++) {
    exts.forEach(ext => paths.push(`${code}_${i}.${ext}`));
  }
  await supabase.storage.from(SKU_BUCKET).remove(paths);
}
