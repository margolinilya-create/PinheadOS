// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from './testutil/sourceFiles';

/**
 * СТОРОЖ, ЧИТАЮЩИЙ ФАЙЛЫ, РАБОТАЕТ В NODE, А НЕ В jsdom (обзор 26.09, п. 14).
 *
 * Vitest поднимает jsdom для КАЖДОГО файла глобальной настройкой
 * (`environment: 'jsdom'` в `vite.config.js`), и на замере 26.09 среда стоила
 * 230 с суммарно при 59 с самих тестов. Сторожа, которые читают миграции
 * и исходники через `node:fs`, DOM не трогают — им хватает docblock
 * `// @vitest-environment node` в первой строке.
 *
 * Механизм держится на одной строке в каждом файле, и новый сторож её
 * не унаследует: этот тест находит файлы-сторожа без пометки. Признак —
 * чтение файловой системы при отсутствии обращений к DOM и рендеру.
 *
 * Мутация (проверена 26.09): снять docblock у `src/lintRatchet.test.ts` —
 * красный с именем файла.
 */

const READS_FS = /\b(readFileSync|readdirSync)\b/;
const NEEDS_DOM = /\brender\(|\bdocument\.|\bwindow\.|\blocalStorage\b|\bscreen\.|@testing-library|\bjsdom\b|\bnavigator\.|\brenderHook\b|\bfireEvent\b|\bact\(/;
const DOCBLOCK = /^(\/\/\s*@vitest-environment\s+node|\/\*\*?\s*@vitest-environment\s+node\s*\*\/)/;

describe('файлы-сторожа помечены node-средой', () => {
  // Сам этот файл исключён: маркеры DOM в нём — текст регулярных выражений
  const tests = sourceFiles(SRC_DIR, { tests: true })
    .filter((p) => /\.test\.[jt]sx?$/.test(p) && !p.endsWith('guardEnv.test.ts'));

  it('каждый тест с чтением файлов и без DOM несёт `// @vitest-environment node`', () => {
    const missing = tests
      .map((p) => ({ rel: relative(SRC_DIR, p), text: readSource(p) }))
      .filter(({ text }) => READS_FS.test(text) && !NEEDS_DOM.test(text))
      .filter(({ text }) => !DOCBLOCK.test(text.trimStart()))
      .map(({ rel }) => rel);
    expect(
      missing,
      'сторож без пометки поднимает jsdom впустую — добавьте первой строкой `// @vitest-environment node`',
    ).toEqual([]);
  });

  it('файл с DOM не помечен node-средой (иначе упадёт на первом `window`)', () => {
    const wrong = tests
      .map((p) => ({ rel: relative(SRC_DIR, p), text: readSource(p) }))
      .filter(({ text }) => DOCBLOCK.test(text.trimStart()) && NEEDS_DOM.test(text))
      .map(({ rel }) => rel);
    expect(wrong).toEqual([]);
  });

  it('в проекте есть кого сторожить', () => {
    expect(tests.length).toBeGreaterThan(200);
  });
});
