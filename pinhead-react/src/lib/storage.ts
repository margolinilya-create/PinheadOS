/* ── Centralized storage utilities ── */

import { supabase } from './supabase';
import { safeFileName, sanitizeKeyPart, translitAscii } from '../utils/storageKey';

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

/*
 * `ensureBucket()` УДАЛЁН, и это не упрощение.
 *
 * Он звал `getBucket` и, не найдя бакета, `createBucket` — а создание бакета
 * требует `service_role`, которого в браузере нет и быть не может (см.
 * `supabase/functions/admin-users`). С ключом `anon` вызов не проходил
 * НИКОГДА, ошибка не проверялась, и всё это стоило лишнего round-trip
 * на первой загрузке фото.
 *
 * Бакет `sku-photos` заведён миграцией и живёт в схеме; если его нет, чинить
 * это надо миграцией, а не попыткой из клиента, которая молча не срабатывает.
 */

/**
 * Ключ фото артикула — ОДНА функция на загрузку и на удаление.
 *
 * Ключ строго ASCII: правило общее на весь проект (`utils/storageKey`).
 * Здесь его собирали руками, и дважды мимо: расширение бралось как
 * `file.name.split('.').pop()`, что у имени БЕЗ точки отдаёт имя целиком —
 * фолбэк `|| 'jpg'` не срабатывал никогда, — а код артикула уходил в ключ
 * вовсе без обеззараживания. Кириллица в ключе это `InvalidKey` от Supabase
 * и «фото не загрузилось» без единого объяснения.
 *
 * Одна функция, а не два выражения рядом: `deleteSkuPhoto` собирает те же
 * пути, и стоило обеззаразить только загрузку, как удаление перестало бы
 * находить свои же файлы — молча, потому что `remove` несуществующего пути
 * ошибкой не считается.
 */
export function skuPhotoPath(code: string, index: number, ext: string): string {
  return `${sanitizeKeyPart(translitAscii(code)) || 'sku'}_${index}.${ext}`;
}

export async function uploadSkuPhoto(code: string, file: File, index: number = 0): Promise<string | null> {
  const ext = safeFileName(file.name, 'photo', 'jpg').split('.').pop() as string;
  const path = skuPhotoPath(code, index, ext);

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
    // Тот же `skuPhotoPath`, что у загрузки: собранный здесь заново, он
    // разошёлся бы с ней на первом же артикуле с кириллицей в коде
    exts.forEach((ext) => paths.push(skuPhotoPath(code, i, ext)));
  }
  await supabase.storage.from(SKU_BUCKET).remove(paths);
}
