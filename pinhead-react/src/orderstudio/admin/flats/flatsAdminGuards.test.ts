// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторож админки флэтов `orderstudio/admin/flats/**` (веха 5б, задача 6б; К14,
 * Global Constraints):
 * - **из ERP — ни одного импорта** (как в `design/**`): разрезка чанков
 *   `ErpStates`/`ErpSkeletons` не сдвигается, бюджет оболочки ERP цел;
 * - **нет HTML-строкой в DOM**: `innerHTML`, `outerHTML =`, `insertAdjacentHTML`,
 *   `dangerouslySetInnerHTML` — SVG силуэта показывается только `<img>` или холстом;
 * - **иконочная кнопка с именем**: `<button>`, внутри которой одна `DesignIcon`
 *   без текста, обязана нести `aria-label` («Удалить точку 3», «Поднять зону «Грудь»»).
 */
const DIR = join(SRC_DIR, 'orderstudio', 'admin', 'flats');
const files = sourceFiles(DIR).map((f) => ({ rel: relative(DIR, f).split(sep).join('/'), text: readSource(f) }));

function specifiers(text: string): string[] {
  const re = /(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g;
  return [...text.matchAll(re)].map((m) => m[2]);
}

export const ERP_IMPORT = (spec: string) => /(^|\/)erp(\/|$)/.test(spec);
export const HTML_SINK = /\binnerHTML\b|\bouterHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML/;

/** Кнопки, всё содержимое которых — одна `DesignIcon`, без `aria-label` у кнопки */
export function unnamedIconButtons(text: string): string[] {
  const re = /<button\b([^>]*)>\s*<DesignIcon\b[^>]*\/>\s*<\/button>/g;
  return [...text.matchAll(re)].filter((m) => !/\baria-label=/.test(m[1])).map((m) => m[0]);
}

describe('admin/flats — сторожа', () => {
  it('в каталоге есть что проверять', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(['FlatEditor.jsx', 'FlatPreview.jsx', 'AreasSection.jsx']));
  });

  it('ни одного импорта ERP', () => {
    const bad = files.flatMap((f) => specifiers(f.text).filter(ERP_IMPORT).map((s) => `${f.rel}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('нет HTML-строкой в DOM', () => {
    expect(files.filter((f) => HTML_SINK.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it('у иконочных кнопок есть aria-label', () => {
    expect(files.flatMap((f) => unnamedIconButtons(f.text).map((b) => `${f.rel}: ${b}`))).toEqual([]);
  });

  it('мутации: сторожа краснеют на нарушениях', () => {
    expect(specifiers("import { Icon } from '../../../erp/components/Icon';").some(ERP_IMPORT)).toBe(true);
    expect(specifiers("const m = import('../../../erp/store/useErpStore');").some(ERP_IMPORT)).toBe(true);
    expect(HTML_SINK.test('<div dangerouslySetInnerHTML={{ __html: svg }} />')).toBe(true);
    expect(HTML_SINK.test('el.innerHTML = svg;')).toBe(true);
    expect(unnamedIconButtons('<button type="button" onClick={go}><DesignIcon name="trash" /></button>')).toHaveLength(1);
    expect(unnamedIconButtons('<button type="button" aria-label="Удалить точку 3"><DesignIcon name="trash" /></button>')).toEqual([]);
    expect(unnamedIconButtons('<button type="button"><DesignIcon name="plus" />Добавить зону</button>')).toEqual([]);
  });
});
