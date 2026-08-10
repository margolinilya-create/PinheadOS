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
 * Тест читает исходник экрана: перечисления в нём — обычные объектные литералы,
 * и других способов заметить пропуск ключа нет.
 */

const SCREEN = readFileSync(
  join(process.cwd(), 'src/erp/screens/Warehouse.jsx'), 'utf8',
);

/** Ключи объектного литерала `const NAME = { … }` из исходника экрана */
function keysOf(constName: string): string[] {
  const start = SCREEN.indexOf(`const ${constName} = {`);
  if (start < 0) throw new Error(`в экране склада нет ${constName}`);
  const end = SCREEN.indexOf('};', start);
  // Ключи бывают по несколько в строке — якорь на начало строки их терял
  return [...SCREEN.slice(start, end).matchAll(/[{,]\s*(\w+):/g)].map((m) => m[1]);
}

const TYPES = Object.keys(WAREHOUSE_TASK_TYPE_LABELS);

describe('типы складских задач заведены целиком', () => {
  it.each(['TYPE_ICON', 'TERMINAL', 'TYPE_ORDER'])(
    'каждый тип есть в %s',
    (constName) => {
      const keys = new Set(keysOf(constName));
      const missing = TYPES.filter((t) => !keys.has(t));
      expect(missing, `${constName}: не заведены ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('у каждого типа есть своя вкладка', () => {
    const tabs = SCREEN.slice(SCREEN.indexOf('const TABS = ['), SCREEN.indexOf('];', SCREEN.indexOf('const TABS = [')));
    const missing = TYPES.filter((t) => !tabs.includes(`'${t}'`));
    expect(missing, `нет вкладки: ${missing.join(', ')}`).toEqual([]);
  });

  it('у каждого типа есть ветка в Drawer — иначе карточка откроется пустой', () => {
    const missing = TYPES.filter((t) => !SCREEN.includes(`open.task.task_type === '${t}'`));
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
