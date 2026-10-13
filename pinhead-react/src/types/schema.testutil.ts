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

/**
 * Все таблицы схемы — имена из блока `Tables: { … }` снимка.
 *
 * Нужна там, где имя таблицы вылавливается из СВОБОДНОГО ТЕКСТА и его надо
 * отличить от чего-то похожего: в теле функции БД рядом с `erp_orders` стоят
 * `erp_has_permission` и `erp_clamp_done`, и без сверки со снимком сторож
 * объявил бы функции таблицами (`realtimeCoverage.test.ts`).
 */
export function tableNames(): string[] {
  const start = generated.indexOf('    Tables: {');
  if (start < 0) throw new Error('в снимке нет блока Tables — формат database.generated.ts изменился?');
  /**
   * Разбор ОГРАНИЧЕН блоком `Tables`. Соседний `Views` и особенно `Functions`
   * записаны тем же отступом, и «всё после Tables» объявляло таблицами имена
   * функций — сторож realtime тут же потребовал подписки на `erp_update_order`.
   */
  const end = generated.indexOf('    Views: {', start);
  const block = generated.slice(start, end > 0 ? end : undefined);
  const names = [...block.matchAll(/^ {6}(\w+): \{$/gm)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error('не разобрано ни одной таблицы — формат database.generated.ts изменился?');
  }
  return names;
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

/**
 * Обнуляемость колонок таблицы: «колонка → бывает ли NULL».
 *
 * ВЫНЕСЕНО СЮДА, А НЕ СКОПИРОВАНО (правило проекта): разбор жил внутри
 * `schema.test.ts`, и второму сторожу — `devWithoutOrder.test.ts`, который
 * проверяет, что `order_id` разработки и вложения ДЕЙСТВИТЕЛЬНО обнуляем, —
 * понадобилось то же самое. Копия рядом однажды разошлась бы с оригиналом,
 * и оба остались бы «рабочими»: ровно то, ради чего в проекте появились
 * `.testutil`-модули.
 *
 * Читается ТОТ ЖЕ блок `Row`, что у `columnsOf`: в `Insert`/`Update` почти
 * всё необязательно, и обнуляемость там означала бы другое.
 */
export function nullableOf(table: string): Map<string, boolean> {
  const start = generated.indexOf(`      ${table}: {`);
  if (start < 0) throw new Error(`таблицы ${table} нет в схеме — переименована или удалена?`);
  const rowStart = generated.indexOf('Row: {', start);
  const rowEnd = generated.indexOf('        }', rowStart);
  const out = new Map<string, boolean>();
  for (const m of generated.slice(rowStart, rowEnd).matchAll(/^\s{10}(\w+)[?]?:\s*(.+?)$/gm)) {
    out.set(m[1], /\|\s*null/.test(m[2]));
  }
  if (out.size === 0) {
    throw new Error(`у ${table} не разобрана обнуляемость — формат database.generated.ts изменился?`);
  }
  return out;
}
