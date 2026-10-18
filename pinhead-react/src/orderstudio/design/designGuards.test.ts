// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../testutil/sourceFiles';

/**
 * Сторожа модуля `orderstudio/design/` (план вехи 5а, решения 9 и 10;
 * проверка безопасности H1, H2):
 * - **из ERP — ни одного импорта**, даже разрешённых Order примитивов: тогда
 *   разрезка `ErpStates`/`ErpSkeletons` не сдвинется (бюджет оболочки ERP);
 * - **нет HTML-строкой в DOM**: `innerHTML`, `outerHTML =`, `insertAdjacentHTML`,
 *   запись в документ `write`, `dangerouslySetInnerHTML` — SVG собирается `DOMParser`
 *   + `importNode`, показывается `<img>`;
 * - нет открытия окна (`open`), `<iframe>`/`<object>`/`<embed>` — blob-URL логотипа
 *   никуда, кроме `<img>`, не уходит;
 * - чистое ядро (геометрия, справочник, файлы, модель, сцена) — без React.
 */
const DESIGN_DIR = join(SRC_DIR, 'orderstudio', 'design');
const files = sourceFiles(DESIGN_DIR).map((f) => ({ rel: relative(DESIGN_DIR, f).split(sep).join('/'), text: readSource(f) }));

/** Спецификаторы модулей: статический импорт, реэкспорт, динамический `import()` */
function specifiers(text: string): string[] {
  const re = /(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g;
  return [...text.matchAll(re)].map((m) => m[2]);
}

const PURE_DIRS = ['geometry/', 'catalog/', 'assets/', 'model/', 'export/'];
const PURE_FILES = ['types.ts', 'limits.ts'];
/** Хуки (`catalog/useFlatsCatalog.ts`, задача 5) — React по назначению, они не ядро */
const isHook = (rel: string) => /(^|\/)use[A-Z][^/]*$/.test(rel);
const isPure = (rel: string) => PURE_FILES.includes(rel)
  || (PURE_DIRS.some((d) => rel.startsWith(d)) && /\.ts$/.test(rel) && !isHook(rel));

const HTML_SINKS = /\binnerHTML\b|\bouterHTML\s*=|insertAdjacentHTML|document\s*\.\s*write|dangerouslySetInnerHTML/;
const ESCAPES = /\bwindow\s*\.\s*open\b|<iframe|<object|<embed/i;

describe('сторожа модуля дизайна', () => {
  it('обход видит модуль (иначе проверять нечего)', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.rel === 'assets/sanitizeSvg.ts')).toBe(true);
  });

  it('ни одного импорта из ERP', () => {
    const bad = files.flatMap((f) => specifiers(f.text).filter((s) => /(^|\/)erp(\/|$)/.test(s)).map((s) => `${f.rel}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('нет HTML-строкой в DOM', () => {
    expect(files.filter((f) => HTML_SINKS.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it('нет открытия окна, iframe, object, embed', () => {
    expect(files.filter((f) => ESCAPES.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it('чистое ядро без React', () => {
    const bad = files.filter((f) => isPure(f.rel) && specifiers(f.text).some((s) => /^react(-dom|-konva)?(\/|$)/.test(s) || s === 'zustand'));
    expect(bad.map((f) => f.rel)).toEqual([]);
  });

  it('проверка ловит то, что должна (мутация на строке)', () => {
    expect(specifiers("import { x } from '../../erp/types';").some((s) => /(^|\/)erp(\/|$)/.test(s))).toBe(true);
    expect(specifiers("const m = await import('../../../erp/store/useErpStore');")).toEqual(['../../../erp/store/useErpStore']);
    expect(HTML_SINKS.test('holder.innerHTML = svg')).toBe(true);
    expect(HTML_SINKS.test('el.outerHTML = s')).toBe(true);
    expect(ESCAPES.test(['window', "open(url, '_blank')"].join('.'))).toBe(true);
  });
});
