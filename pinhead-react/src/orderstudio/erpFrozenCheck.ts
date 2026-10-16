/**
 * Чистая логика сторожа «ERP заморожен» (erpFrozen.test.ts) и скрипта
 * `npm run erp:freeze` (scripts/erp-freeze.mjs): сравнение манифеста хэшей
 * и поиск DDL/DML по объектам `erp_*` в миграциях.
 *
 * Зачем отдельный модуль: сторож и скрипт обязаны судить одинаково, иначе
 * «заморозка» и проверка разойдутся.
 */

export interface ManifestDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

/** Сравнение двух карт «путь → хэш»; списки отсортированы, чтобы сообщение было стабильным */
export function diffManifest(expected: Record<string, string>, actual: Record<string, string>): ManifestDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [path, hash] of Object.entries(actual)) {
    if (!(path in expected)) added.push(path);
    else if (expected[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(expected)) {
    if (!(path in actual)) removed.push(path);
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

const ERP = String.raw`(?:public\.)?erp_[a-z0-9_]*`;
const IF_EXISTS = String.raw`(?:if\s+exists\s+)?`;

/**
 * Что считается правкой ERP. Чтение (`select … from erp_employees` в теле
 * функции Order) — не нарушение: Order читает ERP, но не пишет в него.
 *
 * `create trigger|policy … on erp_x` требует после имени таблицы ключевое слово
 * (for/to/using/…): иначе `join erp_e on erp_e.id = …` внутри политики Order
 * принимался бы за политику на таблице ERP.
 */
const FORBIDDEN: RegExp[] = [
  new RegExp(String.raw`\balter\s+table\s+${IF_EXISTS}(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bdrop\s+(?:table|function|trigger|policy|index|view)\s+${IF_EXISTS}${ERP}`, 'gi'),
  new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|view|index)\s+${ERP}`, 'gi'),
  new RegExp(
    String.raw`\bcreate\s+(?:trigger|policy)\b[^;]*?\bon\s+${ERP}\s+(?:as|for|to|using|with|before|after|instead|referencing|each|from|when|execute)\b`,
    'gi',
  ),
  new RegExp(String.raw`\binsert\s+into\s+${ERP}`, 'gi'),
  new RegExp(String.raw`\bupdate\s+(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${ERP}`, 'gi'),
];

/** Фрагменты SQL, правящие объекты `erp_*`; пусто — миграция ERP не трогает */
export function erpDdlViolations(sql: string): string[] {
  const found: string[] = [];
  for (const re of FORBIDDEN) {
    for (const m of sql.matchAll(re)) found.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return found;
}
