// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторож рестайла «Каталога моделей и цен» (`/sku`, веха 8, задача 3).
 *
 * Глобальный `styles/editors.css` удалён: каждое его правило действовало на
 * всю вкладку, включая экраны ERP после `/admin`. Возврат глобальных классов
 * или инлайн-стилей вернул бы и ту ловушку, и обход токенов. Проверяется
 * результат: файла нет, модули — только токены, разметка — без инлайн-стилей
 * (кроме вычисляемого цвета образца), без кликабельных `div`, глифов-иконок
 * и HTML строкой; карточка модели разрезана.
 */
const EDITOR_DIR = join(SRC_DIR, 'components', 'editors');
const rel = (p: string) => relative(SRC_DIR, p).split('\\').join('/');
/** Файлы «Каталога моделей» (экспресс — своя задача и свой сторож) */
const isSku = (p: string) => /components\/editors\/(SkuEditor|sku\/)/.test(rel(p));

const CSS = sourceFiles(EDITOR_DIR, { ext: /\.module\.css$/ }).filter(isSku);
const JSX = sourceFiles(EDITOR_DIR, { ext: /\.jsx$/ }).filter(isSku);

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Нарушения CSS-модуля: всё, что обходит токены `:root` */
export function cssOffences(css: string): string[] {
  const text = withoutComments(css);
  const out: string[] = [];
  if (/:global\b/.test(text)) out.push(':global');
  if (/!important/.test(text)) out.push('!important');
  if (/var\(\s*--[\w-]+\s*,/.test(text)) out.push('фолбэк var(--x, …)');
  if (/#[0-9a-fA-F]{3,8}\b/.test(text)) out.push('цвет литералом (#…)');
  if (/\brgba?\(|\bhsla?\(/.test(text)) out.push('цвет литералом (rgb/hsl)');
  const sizes = [...text.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
  if (sizes.some((v) => !v.startsWith('var(--type-'))) out.push('кегль не токеном --type-*');
  return out;
}

/** Нарушения разметки */
export function jsxOffences(code: string): string[] {
  // Комментарии объясняют, что было («↻» только с title) — их не проверяем
  const src = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const out: string[] = [];
  const styles = [...src.matchAll(/style=\{([^}]*\}?)\}/g)].map((m) => m[1]);
  if (styles.some((s) => !/swatchColor\(|'--swatch-color'/.test(s))) out.push('инлайн-стиль');
  if (/<div[^>]*\sonClick=/.test(src)) out.push('<div onClick>');
  if (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(src)) out.push('HTML строкой');
  if (/[↓↑↻✕✓▲▼]|&#10005;|&#10003;|&#8381;|&rarr;/.test(src)) out.push('глиф вместо Icon/текста');
  if (/className="[^"]*\b(sku-|pe-|cat-rule|extras-|econ-|fabric-|page-search)/.test(src)) out.push('глобальный класс editors.css');
  return out;
}

describe('«Каталог моделей и цен» — без глобального editors.css', () => {
  it('styles/editors.css удалён, его никто не импортирует', () => {
    expect(existsSync(join(SRC_DIR, 'styles', 'editors.css'))).toBe(false);
    const importers = sourceFiles(SRC_DIR).filter((p) => /styles\/editors\.css['"]/.test(readSource(p))).map(rel);
    expect(importers).toEqual([]);
  });

  it('модули есть — иначе сторож проверяет пустоту', () => {
    expect(CSS.length).toBeGreaterThanOrEqual(5);
    expect(JSX.length).toBeGreaterThanOrEqual(15);
  });

  it('CSS-модули — только токены и ≤ 400 строк', () => {
    const bad = CSS.flatMap((p) => {
      const css = readSource(p);
      const lines = css.split('\n').length;
      return [...cssOffences(css), ...(lines > 400 ? [`${lines} строк`] : [])].map((o) => `${rel(p)}: ${o}`);
    });
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('разметка без инлайн-стилей, <div onClick>, глифов, HTML строкой и глобальных классов', () => {
    const bad = JSX.flatMap((p) => jsxOffences(readSource(p)).map((o) => `${rel(p)}: ${o}`));
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('карточка модели разрезана: окно и секции ≤ 250 строк', () => {
    const files = JSX.filter((p) => /sku\/(SkuDetailModal|skuDetail\/)/.test(rel(p)));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const long = files.map((p) => [rel(p), readSource(p).split('\n').length] as const).filter(([, n]) => n > 250);
    expect(long).toEqual([]);
  });

  it('сторож ловит нарушения (мутация)', () => {
    expect(cssOffences('.a { color: #2B2BF0 }')).toContain('цвет литералом (#…)');
    expect(cssOffences('.a { font-size: 9px }')).toContain('кегль не токеном --type-*');
    expect(cssOffences('.a { color: var(--ink, #000) }')).toContain('фолбэк var(--x, …)');
    expect(cssOffences('.a :global(.btn) { margin: 0 }')).toContain(':global');
    expect(cssOffences('.a { font-size: var(--type-label); color: var(--text) }')).toEqual([]);
    expect(jsxOffences('<td style={{ fontSize: 11 }}>')).toContain('инлайн-стиль');
    expect(jsxOffences('<button style={swatchColor(c.hex)} />')).toEqual([]);
    expect(jsxOffences('<div className="x" onClick={go}>')).toContain('<div onClick>');
    expect(jsxOffences('<button>Excel ↓</button>')).toContain('глиф вместо Icon/текста');
    expect(jsxOffences('<div className="sku-ed-panel">')).toContain('глобальный класс editors.css');
  });
});
