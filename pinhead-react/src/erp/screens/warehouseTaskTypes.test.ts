// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../types';
import { TABS } from './warehouse/warehouseTasks';
import { latestMatching, withoutComments } from '../utils/migrations.testutil';

/**
 * Новый тип складской задачи имеет ДВЕНАДЦАТЬ точек касания, и пропуск любой
 * из них ломает экран по-своему. Самая неприятная — терминальный статус.
 *
 * Если тип не вписан в `TERMINAL`, задача НИКОГДА не считается закрытой:
 * `taskVariant` не даёт ей вид «готово», фильтр «только открытые» оставляет её
 * в списке навсегда, а счётчик на пункте меню показывает вечный бейдж. Ничего
 * не падает — просто у склада всегда что-то «горит», и понять что именно
 * нельзя, потому что задача на вид закрыта.
 *
 * Тест читает исходники: перечисления в них — обычные объектные литералы,
 * и других способов заметить пропуск ключа нет.
 *
 * Файлов ДВА, и это не педантизм. Таблиц терминальных статусов тоже две:
 * своя у экрана и своя у бейджа меню (`store/orderHelpers.ts`). Тест читал
 * только экран — и `fg_receipt`, не вписанный во вторую, дал ровно тот вечный
 * бейдж, о котором написано выше. Сторож, проверяющий одну копию из двух,
 * не сторожит ничего.
 */

/**
 * С 05.10 (правка п. 8) таблицы типов живут в `warehouse/warehouseTasks.js`,
 * а ветки формы — в `warehouse/WarehouseTaskDrawer.jsx`: экран стоял
 * на потолке ратчета размера. Сторож читает их по новым адресам.
 */
const SOURCES: Record<string, string> = {
  screen: readFileSync(join(process.cwd(), 'src/erp/screens/warehouse/warehouseTasks.js'), 'utf8'),
  drawer: readFileSync(join(process.cwd(), 'src/erp/screens/warehouse/WarehouseTaskDrawer.jsx'), 'utf8'),
  helpers: readFileSync(join(process.cwd(), 'src/erp/store/orderHelpers.ts'), 'utf8'),
};

/** Ключи объектного литерала `const NAME = { … }` из исходника */
function keysOf(constName: string, where: keyof typeof SOURCES = 'screen'): string[] {
  const src = SOURCES[where];
  // `const X = {` и `const X: Record<string, string> = {` — оба вида объявления
  const decl = new RegExp(`(?:export )?const ${constName}(?::[^=]+)? = \\{`);
  const start = src.search(decl);
  if (start < 0) throw new Error(`в ${where} нет ${constName}`);
  const end = src.indexOf('};', start);
  // Ключи бывают по несколько в строке — якорь на начало строки их терял
  return [...src.slice(start, end).matchAll(/[{,]\s*(\w+):/g)].map((m) => m[1]);
}

const TYPES = Object.keys(WAREHOUSE_TASK_TYPE_LABELS);

describe('типы складских задач заведены целиком', () => {
  it.each(['TYPE_ICON', 'TERMINAL', 'TYPE_ORDER'])(
    'каждый тип есть в %s (экран склада)',
    (constName) => {
      const keys = new Set(keysOf(constName));
      const missing = TYPES.filter((t) => !keys.has(t));
      expect(missing, `${constName}: не заведены ${missing.join(', ')}`).toEqual([]);
    },
  );

  /**
   * Вторая таблица терминальных статусов — у бейджа меню. Пропуск здесь
   * не виден на экране склада вовсе: задача там выглядит закрытой, а счётчик
   * в меню горит вечно, и связать одно с другим невозможно.
   */
  it('каждый тип есть в WAREHOUSE_TERMINAL (бейдж меню)', () => {
    const keys = new Set(keysOf('WAREHOUSE_TERMINAL', 'helpers'));
    const missing = TYPES.filter((t) => !keys.has(t));
    expect(missing, `WAREHOUSE_TERMINAL: не заведены ${missing.join(', ')}`).toEqual([]);
  });

  it('обе таблицы терминальных статусов согласованы между собой', () => {
    expect([...keysOf('TERMINAL')].sort())
      .toEqual([...keysOf('WAREHOUSE_TERMINAL', 'helpers')].sort());
  });

  /**
   * Вкладки — операции склада (правка 05.10, п. 8), и тип обязан попасть
   * РОВНО в одну: без вкладки задача видна только во «Все», в двух —
   * дублируется и считается дважды.
   */
  it('каждый тип — ровно в одной рабочей вкладке', () => {
    const wrong = TYPES.filter((t) => TABS.filter((tab) => tab.types?.includes(t)).length !== 1);
    expect(wrong, `тип не в одной вкладке: ${wrong.join(', ')}`).toEqual([]);
  });

  it('у каждого типа есть ветка в Drawer — иначе карточка откроется пустой', () => {
    const missing = TYPES.filter((t) => !SOURCES.drawer.includes(`open.task.task_type === '${t}'`));
    expect(missing, `нет ветки Drawer: ${missing.join(', ')}`).toEqual([]);
  });

  it('CHECK в базе перечисляет ровно те же типы', () => {
    const sql = withoutComments(latestMatching(
      /add constraint erp_warehouse_tasks_task_type_check/,
      'CHECK на типы складских задач',
    ));
    const block = sql.slice(sql.indexOf('erp_warehouse_tasks_task_type_check'));
    const list = block.slice(0, block.indexOf('));', block.indexOf('check (')));
    const inSql = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const missing = TYPES.filter((t) => !inSql.includes(t));
    expect(missing, `CHECK не знает про: ${missing.join(', ')}`).toEqual([]);
  });
});
