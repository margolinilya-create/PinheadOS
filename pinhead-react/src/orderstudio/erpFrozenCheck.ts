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

const NAME = String.raw`(?:\S+\s+)`;
const KW = String.raw`(?:as|for|to|using|with|before|after|instead|referencing|each|from|when|execute)`;

/**
 * Что считается правкой ERP (намерение: схема ERP не меняется вообще).
 * Чтение (`select … from erp_employees`, `join erp_employees e on …` в теле
 * функции или предикате RLS Order) — не нарушение: Order читает ERP, но не пишет.
 *
 * Покрыто: alter table/policy/function/view/publication/trigger/index/sequence по erp_*;
 * drop table/function/trigger/policy/index/view (policy и trigger — и в форме `drop … name on erp_x`);
 * create function/view/table/index по erp_* (в т.ч. `create [unique] index [name] on erp_x`);
 * create trigger/policy … on erp_x (в т.ч. многострочно); insert/update/delete/truncate;
 * grant/revoke … on erp_x; comment on table/column/function erp_x.
 *
 * `create trigger|policy … on erp_x` требует после имени таблицы ключевое слово
 * (for/to/using/…): иначе `join erp_e on erp_e.id = …` внутри политики Order
 * принимался бы за политику на таблице ERP.
 */
const FORBIDDEN: RegExp[] = [
  new RegExp(String.raw`\balter\s+table\s+${IF_EXISTS}(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(
    String.raw`\balter\s+(?:policy|function|view|materialized\s+view|publication|trigger|index|sequence)\s+${IF_EXISTS}(?:${NAME}on\s+)?${ERP}`,
    'gi',
  ),
  new RegExp(String.raw`\balter\s+publication\s+\S+\s+(?:add|drop|set)\s+table\s+(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bdrop\s+(?:table|function|trigger|policy|index|view)\s+${IF_EXISTS}${ERP}`, 'gi'),
  new RegExp(String.raw`\bdrop\s+(?:policy|trigger)\s+${IF_EXISTS}\S+\s+on\s+${ERP}`, 'gi'),
  new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|view|index)\s+${ERP}`, 'gi'),
  new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:\S+\s+)?on\s+(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bcreate\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(
    String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:trigger|policy)\b[^;]*?\bon\s+${ERP}\s+${KW}\b`,
    'gi',
  ),
  new RegExp(String.raw`\binsert\s+into\s+${ERP}`, 'gi'),
  new RegExp(String.raw`\bupdate\s+(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\b(?:grant|revoke)\b[^;]*?\bon\s+(?:table\s+|function\s+|sequence\s+)?${ERP}`, 'gi'),
  new RegExp(String.raw`\bcomment\s+on\s+(?:table|column|function)\s+${ERP}`, 'gi'),
];

/** Комментарии SQL не код: `-- update erp_orders вручную` нарушением не считается */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Фрагменты SQL, правящие объекты `erp_*`; пусто — миграция ERP не трогает */
export function erpDdlViolations(sql: string): string[] {
  const code = stripSqlComments(sql);
  const found: string[] = [];
  for (const re of FORBIDDEN) {
    for (const m of code.matchAll(re)) found.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return found;
}

const HOW_TO =
  'ERP боевой и в работе над Order не меняется. ' +
  'Если правка ERP согласована владельцем — npm run erp:freeze и коммит манифеста вместе с правкой.';

function describeDiff(d: ManifestDiff): string {
  return [
    ...d.changed.map((f) => `изменён ${f}`),
    ...d.added.map((f) => `добавлен ${f}`),
    ...d.removed.map((f) => `удалён ${f}`),
  ].join(', ');
}

/**
 * Текст отказа сторожа; пустая строка — всё в порядке. Собирается здесь, чтобы
 * сам текст (имя файла и команда `npm run erp:freeze`) проверялся тестом.
 */
export function frozenMessage(kind: 'files' | 'migrations', diff: ManifestDiff, violations: string[] = []): string {
  const list = describeDiff(diff);
  const parts: string[] = [];
  if (list) parts.push(`ERP изменён${kind === 'migrations' ? ' (миграции)' : ''}: ${list}. ${HOW_TO}`);
  if (violations.length) parts.push(`Новая миграция правит объекты erp_*: ${violations.join('; ')}. ${HOW_TO}`);
  return parts.join(' ');
}
