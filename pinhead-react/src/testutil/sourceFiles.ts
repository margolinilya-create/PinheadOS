/**
 * Обход исходников приложения для сторожевых тестов — ОДИН на проект
 * (обзор 26.09, п. 15).
 *
 * До правки десять тестов держали по своей копии рекурсивного `walk`/
 * `sourceFiles`, и копии уже разошлись в мелочах: одна исключала `.testutil.`,
 * другая — нет, третья брала только `.jsx`. Разошедшийся обходчик — это
 * сторож, который смотрит не на тот набор файлов, и молчит об этом.
 *
 * Только для тестов: приложение этот модуль не импортирует.
 *
 * Листинг каталога и текст файла кэшируются на модуль: в одном воркере
 * несколько сторожей обходят одно и то же дерево `src/` (415 модулей),
 * и каждый платил бы за обход и чтение заново.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SRC_DIR = join(process.cwd(), 'src');

const listings = new Map<string, string[]>();
const texts = new Map<string, string>();

/** Все файлы под каталогом, рекурсивно, абсолютными путями (кэш на каталог) */
function allFiles(dir: string): string[] {
  let files = listings.get(dir);
  if (!files) {
    files = [];
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) files.push(...allFiles(p));
      else files.push(p);
    }
    listings.set(dir, files);
  }
  return files;
}

export interface SourceFilesOptions {
  /** Расширения; по умолчанию — код приложения `.ts/.tsx/.js/.jsx` */
  ext?: RegExp;
  /** Включать тесты и тестовые утилиты (`.test.`, `.testutil.`); по умолчанию — нет */
  tests?: boolean;
}

const CODE_EXT = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE = /\.test\.|\.testutil\.|\.d\.ts$/;

/**
 * Модули приложения под каталогом: код без тестов, тестовых утилит
 * и объявлений типов. `ext` сужает набор (например, только `.jsx`),
 * `tests: true` возвращает и тестовые файлы.
 */
export function sourceFiles(dir: string = SRC_DIR, opts: SourceFilesOptions = {}): string[] {
  const ext = opts.ext ?? CODE_EXT;
  return allFiles(dir).filter((p) => ext.test(p) && (opts.tests || !TEST_FILE.test(p)));
}

/** Текст файла (кэш на модуль) */
export function readSource(path: string): string {
  let text = texts.get(path);
  if (text === undefined) {
    text = readFileSync(path, 'utf8');
    texts.set(path, text);
  }
  return text;
}
