// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../testutil/sourceFiles';
import { CELL_SEP, cellKey } from './cellKey';

/**
 * Сырой байт 0x00 в исходнике делает файл «бинарным» для grep, и поиск по
 * `src/` его пропускает (обзор 26.09, п. 19). Разделитель пишется `\u0000`.
 * Мутация (проверена 26.09): вернуть сырой NUL в `stageSizes.ts` — красный
 * с именем файла.
 */
describe('cellKey — ключ ячейки сетки', () => {
  it('склеивает цвет и размер через NUL, без ложных совпадений', () => {
    expect(cellKey('Белый', 'L')).toBe(`Белый${CELL_SEP}L`);
    expect(cellKey('Бел', 'ый L')).not.toBe(cellKey('Белый', 'L'));
    expect(CELL_SEP).toBe('\u0000');
  });

  it('в исходниках нет сырого байта 0x00', () => {
    const binary = sourceFiles(SRC_DIR, { tests: true })
      .filter((p) => readSource(p).includes('\u0000'))
      .map((p) => relative(SRC_DIR, p));
    expect(binary, 'сырой NUL в исходнике — пишите `\\u0000` (см. utils/cellKey)').toEqual([]);
  });
});
