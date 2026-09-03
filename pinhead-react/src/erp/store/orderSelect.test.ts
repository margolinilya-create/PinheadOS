import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ORDER_SELECT, ORDER_LIST_SELECT } from './orderHelpers';

/**
 * Списочный запрос заказов облегчён (D2 аудита): он не тянет колонки, которые
 * читает только карточка. Замерено на проде — 391 кБ против 351 кБ на 76
 * активных заказах, и разрыв растёт линейно.
 *
 * Опасность правки ровно одна: убрать колонку, которую читает какой-нибудь
 * списочный экран. Тогда поле молча станет `undefined` — не ошибка, не пустой
 * экран, а просто «пропала просрочка в карточке очереди». Поэтому список
 * колонок сверяется с тем, что экраны реально читают.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Настоящие колонки `erp_item_stages` — из машинного снимка схемы
 * (`types/database.generated.ts`), тем же разбором, что в `types/schema.test.ts`.
 * Свежесть снимка сторожит тот тест; здесь он нужен как справочник «что вообще
 * бывает колонкой», чтобы отсеять обращения к полям других объектов.
 */
const STAGE_COLUMNS = (() => {
  const generated = readFileSync(join(SRC, 'types/database.generated.ts'), 'utf8');
  const start = generated.indexOf('      erp_item_stages: {');
  if (start < 0) throw new Error('erp_item_stages нет в снимке схемы');
  const rowStart = generated.indexOf('Row: {', start);
  const cols = [...generated.slice(rowStart, generated.indexOf('        }', rowStart))
    .matchAll(/^\s{10}(\w+)[?]?:/gm)].map((m) => m[1]);
  if (cols.length < 15) throw new Error('разбор снимка схемы дал подозрительно мало колонок');
  return new Set(cols);
})();

/** Экраны и утилиты, работающие по ВСЕМУ массиву заказов из списочного запроса */
const LIST_CONSUMERS = [
  'erp/utils/queueEntries.js',
  'erp/utils/routes.ts',
  'erp/utils/filterStages.ts',
  'erp/utils/stageUi.ts',
  'erp/utils/deptLoad.ts',
  'erp/utils/progress.ts',
  'erp/utils/tz.ts',
  'erp/store/orderHelpers.ts',
  'erp/components/kanban/KanbanCard.jsx',
  'erp/screens/queue/QueueCard.jsx',
  'erp/screens/queue/QueueRow.jsx',
];

describe('списочный запрос заказов', () => {
  it('полный и списочный select — разные, и списочный берёт колонки поимённо', () => {
    expect(ORDER_LIST_SELECT).not.toBe(ORDER_SELECT);
    /**
     * Смысл списочного запроса — брать у этапов НЕ ВСЁ, а перечисленное:
     * `select *` в PostgREST тянет и NULL-колонки, а этапов в списке сотни.
     *
     * Здесь стояло сравнение ДЛИН строк — прокси, меряющий не то: списочный
     * запрос длиннее ПОТОМУ ЧТО перечисляет колонки, и каждая новая колонка
     * приближала его к произвольному порогу «+400». Проверяем то, что важно:
     * этапы берутся поимённо в списке и звёздочкой в полном.
     */
    expect(ORDER_LIST_SELECT).not.toMatch(/stages:erp_item_stages \(\*\)/);
    expect(ORDER_SELECT).toMatch(/stages:erp_item_stages \(\*\)/);
    // Оба остаются одним деревом: списочный не должен потерять отношения
    for (const rel of [
      'items:erp_order_items', 'stages:erp_item_stages', 'prints:erp_item_prints',
      'materials:erp_materials', 'attachments:erp_order_attachments',
      'procurement_tasks:erp_procurement_tasks', 'warehouse_ops:erp_warehouse_ops',
      'warehouse_tasks:erp_warehouse_tasks', 'tz_documents:erp_tz_documents',
      // Правки 02.09, п. 2: гейт отгрузки судит о разработке образца
      'developments:erp_experimental',
    ]) {
      expect(ORDER_LIST_SELECT, `в списочном нет ${rel}`).toContain(rel);
      expect(ORDER_SELECT, `в полном нет ${rel}`).toContain(rel);
    }
  });

  it('колонки, нужные гейтам и очереди, из списка НЕ убраны', () => {
    // Каждая из них что-то показывает или гейтит в списочных экранах
    for (const col of [
      'status', 'qty_done', 'qty_rework', 'depends_on', 'department_id',
      'planned_start', 'planned_end', 'started_at', 'finished_at',
      'assignee', 'block_reason', 'queue_position', 'sort_order',
      'overdue_comment', 'overdue_ack_at', 'updated_at',
      // Волна 3: цикл прохода и происхождение (образец/серия) — оба
      // показываются в очереди, и без них бейдж «Образец» молча не рисуется
      'cycle', 'origin',
    ]) {
      expect(ORDER_LIST_SELECT, `колонка ${col} нужна списочным экранам`).toContain(col);
    }
  });

  /**
   * ЭМБЕД РАЗРАБОТОК — ГЕЙТ ОТГРУЗКИ, А НЕ УКРАШЕНИЕ (правки 02.09, п. 2).
   *
   * После п. 1 маршрут образца — одна закупка, и без этих колонок
   * `isOrderReadyToShip` объявил бы заказ готовым к отгрузке в начале
   * разработки. Поле, не попавшее в выборку, приезжает `undefined` МОЛЧА,
   * а гейт написан fail-open — то есть открылся бы ровно там, ради чего
   * заведён. На этом классе ошибок проект уже ловился с `executor`.
   *
   * Самый вероятный промах — забыть ОДИН из двух запросов: карточка заказа
   * работала бы, а список молча пропускал гейт. Поэтому проверяются оба.
   */
  it('разработки берутся поимённо и с явной связью — в ОБОИХ запросах', () => {
    for (const [name, sel] of [['списочный', ORDER_LIST_SELECT], ['полный', ORDER_SELECT]] as const) {
      // Связь названа явно: у erp_experimental два внешних ключа — на заказ
      // и на позицию, и голое имя таблицы оставило бы выбор PostgREST
      expect(sel, name).toContain('developments:erp_experimental!erp_experimental_order_id_fkey');
      // Поимённо: final_package — тяжёлый JSONB, а гейту нужен только исход
      expect(sel, name).not.toMatch(/developments:erp_experimental[^(]*\(\*\)/);
      expect(sel, name).toMatch(/developments:erp_experimental[^)]*outcome/);
    }
  });

  it('убрана размерная сетка — её рисует только карточка', () => {
    expect(ORDER_LIST_SELECT).not.toContain('size_grid');
    expect(ORDER_SELECT).toContain('*'); // полный select её приносит
  });

  /**
   * Сторож против главной ошибки: списочный экран читает поле этапа, которого
   * в лёгком select нет. Ищем обращения вида `stage.X` / `st.X` в файлах,
   * работающих по всему массиву, и требуем колонку в списочном select.
   */
  it('каждое поле этапа, читаемое списочными экранами, есть в списочном select', () => {
    const stageFields = new Set<string>();
    for (const rel of LIST_CONSUMERS) {
      const file = join(SRC, rel);
      let src: string;
      try { src = readFileSync(file, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(/\b(?:stage|st|s)\.([a-z_]{3,})\b/g)) stageFields.add(m[1]);
    }
    /**
     * Что считать колонкой — берём ИЗ СХЕМЫ, а не из списка руками.
     *
     * Здесь стоял белый список из двадцати имён, и `executor` в него не попал —
     * та самая колонка, на которой проект уже ловился 16.08 («колонка, добавленная
     * в `erp_item_stages`, попадает в ORDER_LIST_SELECT тем же коммитом»).
     * Убери её из запроса — сторож промолчал бы, отсев подряда перестал бы
     * работать, и подрядные задания вернулись бы в очередь цеха без единой ошибки.
     * Список, который надо не забыть пополнить, забывают пополнять.
     */
    const used = [...stageFields].filter((f) => STAGE_COLUMNS.has(f));
    expect(used.length).toBeGreaterThan(8); // сторож не сторожит пустоту

    for (const col of used) {
      expect(
        ORDER_LIST_SELECT.includes(col),
        `списочные экраны читают stage.${col}, но его нет в ORDER_LIST_SELECT — поле станет undefined молча`,
      ).toBe(true);
    }
  });

  /**
   * СПЛОШНАЯ проверка, а не по списку потребителей.
   *
   * Проверка выше ищет обращения `stage.X` в перечисленных файлах — и список
   * этот тоже написан руками. `stage.executor` читает `utils/outsourcing.ts`,
   * которого в списке нет: удаление `executor` из запроса проходило мимо ОБОИХ
   * фильтров — и белого списка колонок, и списка потребителей. А цена ровно та,
   * что записана правилом от 16.08: `executor` приезжает `undefined`, отсев
   * подряда молча перестаёт работать, и подрядные задания возвращаются
   * в очередь чужого цеха.
   *
   * Поэтому вопрос поставлен наоборот: не «читает ли кто-то колонку», а
   * «есть ли в запросе КАЖДАЯ колонка этапа». Исключения перечислены поимённо
   * и с причиной — забыть пополнить такой список нельзя, новая колонка валит
   * тест сразу.
   */
  const STAGE_COLUMNS_NOT_ASKED: Record<string, string> = {
    // Этап показывают в списках по статусу и счётчикам; момент вставки строки
    // не читает ни один экран, а этапов в списке сотни
    created_at: 'момент вставки строки не читает ни один списочный экран',
    // Заметка этапа видна только в карточке заказа, а она грузит ORDER_SELECT
    notes: 'заметка этапа читается только в карточке заказа (полный select)',
  };

  it('каждая колонка erp_item_stages либо в списочном запросе, либо в списке исключений', () => {
    const stagesBlock = ORDER_LIST_SELECT.slice(
      ORDER_LIST_SELECT.indexOf('stages:erp_item_stages ('),
      ORDER_LIST_SELECT.indexOf(')', ORDER_LIST_SELECT.indexOf('stages:erp_item_stages (')),
    );
    const asked = new Set(
      stagesBlock.replace('stages:erp_item_stages (', '').split(',')
        .map((c) => c.trim()).filter((c) => /^\w+$/.test(c)),
    );
    const missing = [...STAGE_COLUMNS].filter(
      (c) => !asked.has(c) && !(c in STAGE_COLUMNS_NOT_ASKED),
    );
    expect(
      missing,
      `колонки этапа нет в ORDER_LIST_SELECT: ${missing.join(', ')} — она приедет `
      + 'undefined молча. Либо добавьте в запрос, либо впишите в STAGE_COLUMNS_NOT_ASKED с причиной',
    ).toEqual([]);

    // Исключение, которое перестало быть исключением, — это протухший список
    const stale = Object.keys(STAGE_COLUMNS_NOT_ASKED).filter((c) => asked.has(c));
    expect(stale, `эти колонки уже в запросе: ${stale.join(', ')}`).toEqual([]);
  });

  it('walk находит исходники (иначе список потребителей мог протухнуть)', () => {
    expect(walk(join(SRC, 'erp/utils')).length).toBeGreaterThan(10);
    for (const rel of LIST_CONSUMERS) {
      expect(() => readFileSync(join(SRC, rel), 'utf8'), `${rel} не найден`).not.toThrow();
    }
  });
});
