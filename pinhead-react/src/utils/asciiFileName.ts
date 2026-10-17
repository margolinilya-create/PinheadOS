/**
 * Имя файла → один ASCII-сегмент ключа Storage.
 *
 * Supabase Storage проверяет ключ объекта регуляркой из S3-safe символов,
 * где `\w` объявлен БЕЗ флага `u`, то есть только ASCII: любая русская буква
 * в ключе — ответ `InvalidKey`, и файл не загружается вообще. Имя для
 * человека хранится отдельно; в ключе оно нужно, чтобы объект можно было
 * опознать глазами.
 *
 * ПОЧЕМУ КОПИЯ, А НЕ ИМПОРТ. Правило живёт в `erp/utils/storageKey.ts`, но
 * Order не импортирует рантайм ERP (сторож `orderstudio/erpImports.test.ts`:
 * общий модуль выносится в чанк критического пути оболочки ERP), а ERP
 * заморожен — модуль не переносится. Расхождение копии с оригиналом ловит
 * `asciiFileName.test.ts` (сверка на корпусе имён).
 */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация с сохранением регистра: «ТЗ» → «TZ», «Швейка» → «Shveyka» */
export function translitAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) out += ch;
    else if (ch === lower) out += mapped;
    else out += mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }
  return out;
}

/** Всё, что не ASCII-буква, цифра, `_`, `-` или точка, схлопывается в один «_»; серии точек — в одну */
function sanitizeKeyPart(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\-\s]+/, '')
    .replace(/[._\-\s]+$/, '');
}

/**
 * Безопасное имя «основа.расширение». Расширение отделяется ЗАРАНЕЕ: иначе имя
 * целиком из непереводимых символов съело бы и его. Серии точек схлопываются —
 * иначе «../../» из имени файла уехало бы в ключ объекта.
 */
export function asciiFileName(fileName: string, fallback: string, fallbackExt: string): string {
  const raw = fileName || '';
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? sanitizeKeyPart(translitAscii(raw.slice(dot + 1))).slice(0, 8) : '';
  // Голова, а не хвост: расширение уже отделено, а опознают файл по началу имени
  const base = sanitizeKeyPart(
    sanitizeKeyPart(translitAscii(dot > 0 ? raw.slice(0, dot) : raw)).slice(0, 100));
  return `${base || fallback}.${ext || fallbackExt}`;
}
