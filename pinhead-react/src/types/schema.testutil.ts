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
