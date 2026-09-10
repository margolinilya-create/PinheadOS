/**
 * Разбор снимка схемы (`types/database.generated.ts`) для сторожевых тестов.
 *
 * Только для тестов: приложение этот модуль не импортирует, в бандл он не
 * попадает — та же конвенция, что у `erp/utils/migrations.testutil.ts`.
 *
 * Отдельным файлом, а не копией в каждом тесте. `columnsOf` жила внутри
 * `schema.test.ts`, пока сверка со схемой была нужна одному сторожу.
 * 10.09 понадобилась второму — `erp/utils/auditCoverage.test.ts` сверяет
 * имена колонок, перечисленные в аудит-триггерах. Вторая копия разошлась бы
 * с первой: ровно то, ради чего в проекте и появились `.testutil`-модули.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GENERATED_PATH = join(process.cwd(), 'src/types/database.generated.ts');

const generated = readFileSync(GENERATED_PATH, 'utf8');

/** Текст снимка целиком — для проверок «таблица вообще есть в снимке» */
export function generatedSource(): string {
  return generated;
}

/**
 * Колонки таблицы с признаком «принимает NULL» — из блока `Row: { … }`.
 *
 * Нужна отдельно от `columnsOf`: имя колонки и её ОБНУЛЯЕМОСТЬ — разные
 * вопросы, и сверка по именам на второй не отвечает. Тип строже схемы
 * («в БД null бывает, в типе нет») опаснее: код считает поле всегда
 * заполненным, и `tsc` его не поправит.
 */
export function columnTypesOf(table: string): Map<string, { nullable: boolean }> {
  const start = generated.indexOf(`      ${table}: {`);
  if (start < 0) throw new Error(`таблицы ${table} нет в схеме — переименована или удалена?`);
  const rowStart = generated.indexOf('Row: {', start);
  const rowEnd = generated.indexOf('        }', rowStart);
  const out = new Map<string, { nullable: boolean }>();
  for (const line of generated.slice(rowStart, rowEnd).split('\n')) {
    const m = line.match(/^\s{10}(\w+)\??:\s*(.+?)\s*$/);
    if (m) out.set(m[1], { nullable: /\|\s*null/.test(m[2]) });
  }
  if (out.size === 0) {
    throw new Error(`у ${table} не разобрано ни одной колонки — формат database.generated.ts изменился?`);
  }
  return out;
}

/** Колонки таблицы из блока `Row: { … }` сгенерированного файла */
export function columnsOf(table: string): string[] {
  const start = generated.indexOf(`      ${table}: {`);
  if (start < 0) throw new Error(`таблицы ${table} нет в схеме — переименована или удалена?`);
  const rowStart = generated.indexOf('Row: {', start);
  const rowEnd = generated.indexOf('        }', rowStart);
  const cols = [...generated.slice(rowStart, rowEnd).matchAll(/^\s{10}(\w+)[?]?:/gm)].map((m) => m[1]);
  // Сторож, разобравший пустой список, зелен на чём угодно: формат снимка
  // мог поменяться, и тогда все проверки поверх него молча перестают работать.
  if (cols.length === 0) {
    throw new Error(`у ${table} не разобрано ни одной колонки — формат database.generated.ts изменился?`);
  }
  return cols;
}
