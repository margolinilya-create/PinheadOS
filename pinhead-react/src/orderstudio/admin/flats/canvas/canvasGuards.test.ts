// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../../testutil/sourceFiles';

/**
 * Сторожа холста редактора флэта `admin/flats/canvas/**` (веха 5б, задача 6а;
 * Global Constraints и К14):
 * - ни одного импорта из ERP — разрезка `ErpStates`/`ErpSkeletons` не сдвигается;
 * - konva — только через `design/ui/konva` (Core-подпути, фигуры белого
 *   списка; тесты подменяют этот модуль), не пакетом;
 * - редактор не тянет на холст сеть и сторы: ни `api/`, ни `lib/supabase`,
 *   ни `useDesignStore` (зум позиции заказа), ни `catalogAdmin`;
 * - нет HTML-строкой в DOM; object URL — только в `useSvgImage` (Blob после
 *   санитайзера, URL уходит только в картинку), без `href`.
 */
const DIR = join(SRC_DIR, 'orderstudio', 'admin', 'flats', 'canvas');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = sourceFiles(DIR)
  .map((f) => ({ rel: relative(DIR, f).split(sep).join('/'), text: readSource(f) }))
  .filter((f) => !/\.test\.[jt]sx?$/.test(f.rel));

function specifiers(text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g)].map((m) => m[2]);
}

const ERP = /(^|\/)erp(\/|$)/;
const KONVA_PKG = /^(react-)?konva(\/|$)/;
const SIDE_EFFECTS = /(^|\/)api\/|(^|\/)lib\/supabase|useDesignStore|catalogAdmin|(^|\/)store\/use[A-Z]/;
const HTML_SINKS = /\binnerHTML\b|\bouterHTML\s*=|insertAdjacentHTML|document\s*\.\s*write|dangerouslySetInnerHTML/;

describe('сторожа холста редактора флэта', () => {
  it('обход видит модуль', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(['FlatCanvas.jsx', 'AreaShapes.jsx', 'useSvgImage.ts']));
  });

  it('ни одного импорта из ERP', () => {
    expect(files.flatMap((f) => specifiers(f.text).filter((s) => ERP.test(s)).map((s) => `${f.rel}: ${s}`))).toEqual([]);
  });

  it('konva — только через design/ui/konva', () => {
    const bad = files.flatMap((f) => specifiers(f.text).filter((s) => KONVA_PKG.test(s)).map((s) => `${f.rel}: ${s}`));
    expect(bad).toEqual([]);
    const users = files.filter((f) => specifiers(f.text).some((s) => /design\/ui\/konva$/.test(s))).map((f) => f.rel).sort();
    expect(users).toEqual(['AnchorHandles.jsx', 'AreaShapes.jsx', 'CalibrateTool.jsx', 'FlatCanvas.jsx']);
  });

  it('без сети, сторов и писателя справочников', () => {
    expect(files.flatMap((f) => specifiers(f.text).filter((s) => SIDE_EFFECTS.test(s)).map((s) => `${f.rel}: ${s}`))).toEqual([]);
  });

  it('нет HTML-строкой в DOM', () => {
    expect(files.filter((f) => HTML_SINKS.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it('object URL создаёт только useSvgImage, и в нём нет href', () => {
    expect(files.filter((f) => /createObjectURL/.test(code(f.text))).map((f) => f.rel)).toEqual(['useSvgImage.ts']);
    expect(code(files.find((f) => f.rel === 'useSvgImage.ts')!.text)).not.toMatch(/\bhref\b/);
  });

  it('проверка ловит то, что должна (мутация на строке)', () => {
    expect(specifiers("import { Stage } from 'react-konva';").some((s) => KONVA_PKG.test(s))).toBe(true);
    expect(specifiers("import { x } from '../../../../erp/components';").some((s) => ERP.test(s))).toBe(true);
    for (const s of ['../../../api/garmentFlats', '../../../design/store/useDesignStore', '../../../api/catalogAdmin', '../../../../lib/supabase']) {
      expect(SIDE_EFFECTS.test(s), s).toBe(true);
    }
    expect(SIDE_EFFECTS.test('../../../design/edit/flatEdit')).toBe(false);
    expect(HTML_SINKS.test('el.innerHTML = svg')).toBe(true);
  });
});
