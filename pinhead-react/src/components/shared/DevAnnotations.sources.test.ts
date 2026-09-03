import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { withoutJsComments } from '../../erp/utils/migrations.testutil';

/**
 * ТОЧКА МОНТИРОВАНИЯ ВИДЖЕТА ОБРАТНОЙ СВЯЗИ — ОДНА.
 *
 * ЧТО ЛОВИТСЯ. Второй `<Agentation />` где-нибудь в оболочке раздела ничего
 * не роняет: тулбар просто окажется смонтирован дважды, со СВОИМ условием
 * показа. Дальше эти два условия расходятся — в этом проекте так уже
 * случалось не раз, и цена не косметическая: одно из них однажды не будет
 * содержать `import.meta.env.DEV`, и инструмент разработки снова уедет
 * в прод, как уезжал до 03.09 (аудит 29.07, раздел D5).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ И ПОЧЕМУ `.ts`. Обход исходников требует `process`,
 * а в `.jsx` обращение к нему ловит ESLint (`no-undef`); правило проекта —
 * держать такие сторожа в `.ts` (тем же приёмом живёт
 * `erp/utils/adminUsers.test.ts`). Через `import.meta.url` путь тоже
 * не берётся: в среде jsdom это не `file:`-адрес, и `fileURLToPath` бросает.
 * Поведение виджета проверяется рядом — `DevAnnotations.test.jsx`.
 */

const SRC = join(process.cwd(), 'src');

/** Обход всех исходников раздела, кроме самих тестов */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('точка монтирования одна', () => {
  /**
   * Ищем ИМПОРТ пакета, а не слово: комментарии снимаются, потому что
   * объяснение «почему виджет отсюда убран» содержит и имя пакета,
   * и пример вызова `import('agentation')` — сторож ловил бы сам себя.
   * В проекте это уже случалось, ради чего и заведён `withoutJsComments`.
   */
  it('пакет agentation импортирует только DevAnnotations', () => {
    const importers = sourceFiles(SRC).filter((file) => {
      const body = withoutJsComments(readFileSync(file, 'utf8'));
      return /(from|import\()\s*['"]agentation['"]/.test(body);
    });
    expect(importers.map((f) => f.slice(SRC.length + 1))).toEqual([
      join('components', 'shared', 'DevAnnotations.jsx'),
    ]);
  });
});
