import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../types';
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

const SOURCES: Record<string, string> = {
  screen: readFileSync(join(process.cwd(), 'src/erp/screens/Warehouse.jsx'), 'utf8'),
  helpers: readFileSync(join(process.cwd(), 'src/erp/store/orderHelpers.ts'), 'utf8'),
};

/** Ключи объектного литерала `const NAME = { … }` из исходника */
function keysOf(constName: string, where: keyof typeof SOURCES = 'screen'): string[] {
  const src = SOURCES[where];
  // `const X = {` и `const X: Record<string, string> = {` — оба вида объявления
  const decl = new RegExp(`const ${constName}(?::[^=]+)? = \\{`);
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

  it('у каждого типа есть своя вкладка', () => {
    const tabs = SOURCES.screen.slice(SOURCES.screen.indexOf('const TABS = ['), SOURCES.screen.indexOf('];', SOURCES.screen.indexOf('const TABS = [')));
    const missing = TYPES.filter((t) => !tabs.includes(`'${t}'`));
    expect(missing, `нет вкладки: ${missing.join(', ')}`).toEqual([]);
  });

  it('у каждого типа есть ветка в Drawer — иначе карточка откроется пустой', () => {
    const missing = TYPES.filter((t) => !SOURCES.screen.includes(`open.task.task_type === '${t}'`));
    expect(missing, `нет ветки Drawer: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * ТРИНАДЦАТАЯ точка касания (H-10 отчёта QA 13.08.2026). Плитки KPI и
   * объект-накопитель счётчиков были написаны руками, и в обоих не хватало
   * `fg_receipt`: «Все задачи: 1», все плитки по нулям, а карточки для типа,
   * который на экране реально был, нет вовсе. `c[task.task_type] += 1` по
   * несуществующему ключу давал NaN — молча.
   *
   * Теперь и то и другое строится из `TABS`. Тест сторожит именно ЭТО:
   * вернётся рукописный список — вернётся и пропуск.
   */
  it('плитки KPI и счётчики строятся из вкладок, а не переписаны руками', () => {
    expect(SOURCES.screen).toContain('const KPI_TILES = TABS.map(');
    expect(SOURCES.screen).toContain('Object.fromEntries(TABS.map(');
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
