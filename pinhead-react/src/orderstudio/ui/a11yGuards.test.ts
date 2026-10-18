// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../testutil/sourceFiles';

/**
 * Текст только для читалки — класс `.srOnly` CSS-модуля (`orderstudio/ui/a11y.module.css`
 * или локальный). Глобального `visually-hidden` в проекте НЕТ: такой класс
 * в разметке ничего не прячет, и подпись «не заполнено» висела бы видимой
 * поверх ряда вкладок на 375 px (веха 8, задача 5).
 */
const ROOTS = [join(SRC_DIR, 'orderstudio'), join(SRC_DIR, 'components', 'editors')];
const GLOBAL_HIDDEN = /className\s*=\s*\{?\s*["'`][^"'`]*\b(?:visually-hidden|sr-only)\b/;

describe('текст только для читалки — CSS-модулем', () => {
  it('в orderstudio/** и components/editors/** нет className="visually-hidden" / "sr-only"', () => {
    const offenders = ROOTS
      .flatMap((dir) => sourceFiles(dir, { ext: /\.(jsx|tsx)$/ }))
      .filter((p) => GLOBAL_HIDDEN.test(readSource(p)))
      .map((p) => relative(SRC_DIR, p));
    expect(offenders).toEqual([]);
  });

  it('сторож ловит глобальный класс (мутация)', () => {
    expect(GLOBAL_HIDDEN.test('<span className="visually-hidden">x</span>')).toBe(true);
    expect(GLOBAL_HIDDEN.test("<span className={'sr-only'}>x</span>")).toBe(true);
    expect(GLOBAL_HIDDEN.test('<span className={a11y.srOnly}>x</span>')).toBe(false);
  });
});
