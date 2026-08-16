/**
 * Ключ объекта в Supabase Storage — правила, общие для ВСЕХ файлов проекта.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Правило жило внутри `utils/tz.ts` и относилось будто бы
 * к одному ТЗ. На деле оно про Storage: Supabase проверяет ключ регуляркой
 * из S3-safe символов, где `\w` объявлен БЕЗ флага `u`, то есть только ASCII.
 * Любая русская буква в ключе — ответ `InvalidKey`, и файл не загружается вообще.
 * На этом уже ломалось создание ЛЮБОГО заказа с ТЗ; повторить ту же историю
 * на вложениях упаковки и листа закупки было бы обидно, а копия правила рядом —
 * ровно тот способ, которым это происходит.
 *
 * Имя для человека хранится в базе (`file_name`), в ключе оно нужно только
 * чтобы объект можно было опознать глазами.
 */

/**
 * Кириллица → латиница. Нужна не для красоты: Supabase Storage проверяет ключ
 * объекта регуляркой из S3-safe символов, где `\w` объявлен БЕЗ флага `u`, то есть
 * только ASCII. Любая русская буква в ключе — ответ `InvalidKey`, и файл не
 * загружается вообще. Имя для человека живёт в `erp_tz_documents.file_name`,
 * в ключе оно нужно только чтобы объект можно было опознать глазами.
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
    if (mapped === undefined) {
      out += ch;
    } else if (ch === lower) {
      out += mapped;
    } else {
      out += mapped.charAt(0).toUpperCase() + mapped.slice(1);
    }
  }
  return out;
}

/** Всё, что не ASCII-буква, цифра, `_`, `-` или точка, схлопывается в один «_» */
export function sanitizeKeyPart(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\-\s]+/, '')
    .replace(/[._\-\s]+$/, '');
}

/**
 * Ключ хранения файла: tz/<scope>/<group_id>/v<N>-<имя>.
 *
 * Имя транслитерируется и обеззараживается: результат строго ASCII (иначе Storage
 * отвечает `InvalidKey`), слэши и скобки уходят в «_», серии точек схлопываются —
 * иначе «../../» из имени файла уехало бы в ключ объекта. Расширение отделяется
 * заранее: иначе имя целиком из непереводимых символов съело бы и его.
 */

/**
 * Имя файла → безопасная пара «основа + расширение».
 *
 * Расширение отделяется ЗАРАНЕЕ: иначе имя целиком из непереводимых символов
 * съело бы и его. Серии точек схлопываются — иначе «../../» из имени файла
 * уехало бы в ключ объекта.
 */
export function safeFileName(fileName: string, fallback: string, fallbackExt: string): string {
  const raw = fileName || '';
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? sanitizeKeyPart(translitAscii(raw.slice(dot + 1))).slice(0, 8) : '';
  // Голова, а не хвост: расширение уже отделено, а опознают файл по началу имени
  const base = sanitizeKeyPart(
    sanitizeKeyPart(translitAscii(dot > 0 ? raw.slice(0, dot) : raw)).slice(0, 100));
  return `${base || fallback}.${ext || fallbackExt}`;
}

/**
 * Ключ вложения заказа: `att/<scope>/<kind>/<uuid>-<имя>`.
 *
 * `scope` — идентификатор заказа либо `new` для файла, выбранного в форме
 * до того, как заказ существует. Перекладывать объект после создания заказа
 * не нужно и вредно: путь хранится в строке `erp_order_attachments`, а лишнее
 * копирование в бакете — это ещё одно место, где файл может потеряться.
 *
 * `uuid` в имени, а не отметка времени: два файла, выбранных в одну миллисекунду
 * (множественный выбор в диалоге — обычное дело), получили бы один ключ, и
 * второй молча затёр бы первый при `upsert`.
 */
export function attachmentFilePath(
  scope: string, kind: string, uid: string, fileName: string,
): string {
  return `att/${scope}/${kind}/${uid}-${safeFileName(fileName, 'file', 'bin')}`;
}
