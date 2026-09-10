import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { columnsOf } from '../../types/schema.testutil';
import {
  MIGRATIONS_DIR, migration, latestDefining, latestMatching,
  withoutComments, withoutJsComments,
} from './migrations.testutil';

/**
 * Аудит пишет ТРИГГЕР, а подписывает поля React. Две стороны легко разъезжаются:
 * добавили колонку в триггер — история молча показывает сырое `material.kind`
 * вместо «Материал: вид», и никто этого не замечает, пока не понадобится
 * разобраться, кто сорвал заказ.
 *
 * Поэтому список полей берётся из самих миграций, а не дублируется здесь.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТОТ СТОРОЖ ПЕРЕПИСАН 10.09.
 *
 * Он читал ОДИН захардкоженный файл — `20260803240000_erp_audit_by_trigger.sql`.
 * Триггеры пересозданы `20260906193413_erp_audit_live_columns.sql`, и всё,
 * что она добавила, сторож не видел вовсе: он сторожил файл, а не базу —
 * третий случай в проекте после `serverPermissions` и `permissionsCoverage`.
 *
 * Второй пробел был опаснее: имя поля НЕ сверялось со схемой. А `erp_log_changes`
 * читает поле динамически (`execute format('select ($1).%I…')`), то есть
 * `create trigger` компилируется с любым аргументом, а падает при первом
 * `UPDATE` — у пользователя, не в CI. Так `erp_materials_audit` получил
 * несуществующую колонку `price` (реальная — `price_per_unit`), и на боевой
 * базе перестала сохраняться ЛЮБАЯ правка материала: приёмка складом и журнал
 * приёмок вместе с ней. Аудит материалов не записал за всё время ни строки.
 *
 * Отсюда четыре правила этого файла:
 *   1. состояние собирается по ВСЕМ миграциям, последнее слово за поздней;
 *   2. каждое имя сверяется с колонками таблицы (`database.generated.ts`) —
 *      и поля, и ЯКОРЬ `TG_ARGV[0]`: он читается так же динамически
 *      (`v_order := new.order_id`), а `erp_item_stages` не имеет `order_id`
 *      и `erp_order_items` не имеет `item_id` — перепутать можно молча;
 *   3. механизмов аудита ДВА, и спрашивать надо схему, а не знакомые имена.
 *
 * ГРАНИЦА, которую этот сторож НЕ переходит: он читает РЕПОЗИТОРИЙ, а не базу.
 * Ту самую миграцию применили через MCP 06.09, а файл завели 07.09 — сутки
 * он был бы зелёным при сломанном проде. Живую базу из CI не прочитать
 * (`supabase_migrations` не выставлена наружу PostgREST), и закрывает этот
 * разрыв не тест, а ритуал: `npm run migrations:verify` плюс правило
 * «применил → сразу завёл файл» (`supabase/migrations/README.md`).
 */

const SRC = join(process.cwd(), 'src');
const HISTORY = readFileSync(
  join(SRC, 'erp/screens/orderCard/HistorySection.jsx'), 'utf8',
);

/**
 * SQL без комментариев — и строчных, и БЛОЧНЫХ.
 *
 * Обязательно до разбора: объяснение миграции, ПОЧЕМУ поле такое, содержит те же
 * слова в тех же кавычках. Комментарий починки прямо называет `'price'`, и без
 * снятия блочных комментариев сторож разобрал бы его как имя поля — то есть
 * продолжил бы падать на уже исправленной базе.
 */
function stripSqlComments(sql: string): string {
  return withoutComments(withoutJsComments(sql));
}

interface AuditTrigger {
  table: string;
  /**
   * TG_ARGV[0] — колонка, по которой находится ЗАКАЗ: `order_id` берётся
   * из самой строки, `item_id` ведёт в `erp_order_items`. Функция знает
   * ровно эти два варианта, и обращение к ней такое же динамическое
   * (`v_order := new.order_id`), то есть ошибка в якоре роняет UPDATE так же,
   * как ошибка в имени поля. Набор закрыт и КОЛОНКА ДОЛЖНА СУЩЕСТВОВАТЬ:
   * у `erp_item_stages` нет `order_id`, у `erp_order_items` нет `item_id` —
   * перепутать их местами можно молча.
   */
  anchor: string;
  /** Префикс `field_name` в `erp_order_audit` (`material`, `stage`, … либо пустой) */
  prefix: string;
  fields: string[];
}

const DROP_OR_CREATE = new RegExp(
  'drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(\\w+)\\s+on\\s+public\\.\\w+'
  + '|create\\s+trigger\\s+(\\w+)\\s+after\\s+update\\s+on\\s+public\\.(\\w+)'
  + '\\s+for\\s+each\\s+row\\s+execute\\s+function\\s+public\\.erp_log_changes\\s*\\(([^)]*)\\)',
  'gis',
);

/**
 * Действующее состояние аудит-триггеров: обход всех миграций по возрастанию
 * имени, `create` ставит запись, `drop` снимает. Ровно тот же приём, что
 * `latestDefining` у функций, — «работает то, что применили последним».
 */
function auditTriggers(): Map<string, AuditTrigger> {
  const out = new Map<string, AuditTrigger>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = stripSqlComments(migration(file));
    for (const m of sql.matchAll(DROP_OR_CREATE)) {
      const [, dropped, created, table, rawArgs] = m;
      if (dropped) { out.delete(dropped); continue; }
      const args = [...rawArgs.matchAll(/'([^']*)'/g)].map((a) => a[1]);
      // TG_ARGV[0] — колонка связи с заказом, TG_ARGV[1] — префикс, поля с [2]
      const [anchor, prefix, ...fields] = args;
      out.set(created, { table, anchor, prefix, fields });
    }
  }
  return out;
}

/**
 * Второй механизм аудита: `erp_log_order_changes` держит список колонок
 * не в аргументах триггера, а в СВОЁМ ТЕЛЕ (`foreach f in array array[…]`),
 * и ломается точно так же. Сторож, проверяющий только триггеры с аргументами,
 * снова оказался бы белым списком.
 */
function orderAuditFields(): string[] {
  const sql = stripSqlComments(latestDefining('erp_log_order_changes'));
  const block = sql.match(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]/i);
  if (!block) throw new Error('в erp_log_order_changes не найден список колонок');
  return [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const TRIGGERS = auditTriggers();
const ORDER_FIELDS = orderAuditFields();

/** Пары «таблица × колонка», которые аудит читает динамически */
const WATCHED: [string, string][] = [
  ...[...TRIGGERS.values()].flatMap(
    (t) => [t.anchor, ...t.fields].map((f) => [t.table, f] as [string, string]),
  ),
  ...ORDER_FIELDS.map((f) => ['erp_orders', f] as [string, string]),
];

/** Имена в том виде, в каком они лягут в `erp_order_audit.field_name` */
const FIELD_NAMES: string[] = [
  ...[...TRIGGERS.values()].flatMap(
    (t) => t.fields.map((f) => (t.prefix === '' ? f : `${t.prefix}.${f}`)),
  ),
  ...ORDER_FIELDS,
];

describe('аудит читает только существующие колонки', () => {
  it('состояние вообще собралось (иначе сторож охранял бы пустоту)', () => {
    expect(TRIGGERS.size).toBeGreaterThanOrEqual(6);
    expect(ORDER_FIELDS.length).toBeGreaterThanOrEqual(15);
    expect(WATCHED.length).toBeGreaterThanOrEqual(50);
    // Точечные опоры: пропадёт разбор — эти исчезнут первыми
    expect(FIELD_NAMES).toContain('stage.status');
    expect(FIELD_NAMES).toContain('material.accept_status');
    expect(FIELD_NAMES).toContain('planned_start');
    expect(FIELD_NAMES).toContain('shipped_status');
  });

  it.each([...TRIGGERS].map(([name, t]) => [name, t.anchor] as [string, string]))(
    'у триггера %s якорь заказа «%s» — из закрытого набора',
    (_name, anchor) => {
      // Третьего варианта функция не знает: ветка `if TG_ARGV[0] = 'item_id'`,
      // иначе `new.order_id`. Любое иное слово молча уводит в ветку order_id.
      expect(['order_id', 'item_id']).toContain(anchor);
    },
  );

  it.each(WATCHED)(
    'колонка %s.%s существует в схеме',
    (table, field) => {
      expect(
        columnsOf(table),
        `${table}.${field}: аудит читает поле динамически (execute format '($1).%I'), `
        + 'и несуществующее имя роняет КАЖДЫЙ UPDATE строки — не при выкладке, а у пользователя',
      ).toContain(field);
    },
  );
});

describe('аудит триггером и подписи в истории не разъезжаются', () => {
  it.each(FIELD_NAMES)('поле «%s» имеет подпись в истории', (field) => {
    expect(
      HISTORY.includes(`'${field}'`) || HISTORY.includes(`${field}:`),
      `нет подписи для ${field} — история покажет сырое имя колонки`,
    ).toBe(true);
  });

  it('пять смежных таблиц накрыты аудитом, а не только этапы', () => {
    // Сверяем ДЕЙСТВУЮЩИЕ триггеры, а не упоминание таблицы в одном файле:
    // `drop trigger` и комментарий тоже содержат её имя, и проверка на упоминание
    // проходила бы с удалённым триггером. Мутационная проверка это и показала.
    const tables = new Set([...TRIGGERS.values()].map((t) => t.table));
    for (const tbl of [
      'erp_item_stages', 'erp_materials', 'erp_order_items',
      'erp_procurement_tasks', 'erp_subcontracting',
    ]) {
      expect(tables, `${tbl} без триггера аудита`).toContain(tbl);
    }
  });
});

describe('сама функция аудита', () => {
  // Читаем ПОСЛЕДНЕЕ определение: функция пересоздаётся целиком, и прежняя
  // миграция остаётся в репозитории со старыми правилами
  const FN = latestDefining('erp_log_changes');

  it('действующее лицо пишется как uuid, а не только именем', () => {
    // Имя рвётся при переименовании и не различает тёзок — опора должна быть id
    expect(FN).toContain('changed_by_id');
    expect(FN).toContain('actor_id');
    expect(FN).toMatch(/v_actor_id\s*:=\s*\(select auth\.uid\(\)\)/);
  });

  it('аудит не роняет работу цеха, если позиция уже удалена', () => {
    // Триггер AFTER UPDATE: исключение здесь откатило бы саму работу
    expect(FN).toMatch(/if v_order is null then\s+return new;/);
  });

  it('историю нельзя подделать и нельзя читать до одобрения', () => {
    // Политики стояли `true`: неодобренный читал ленту всех заказов и мог в неё дописать
    const sql = latestMatching(
      /create policy erp_stage_events_\w+/, 'политики erp_stage_events',
    );
    const created = sql.match(/create policy erp_stage_events_\w+[\s\S]*?;/g) ?? [];
    expect(created.length).toBe(2);
    for (const p of created) expect(p).toContain('erp_is_member()');
    expect(sql).not.toMatch(/create policy erp_stage_events[\s\S]*?\((?:true)\)/);
  });
});
