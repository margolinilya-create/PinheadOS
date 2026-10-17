// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторожа PDF макета (веха 5а, задача 7; проверка безопасности H1, L6;
 * Review Focus 5 — бюджет):
 * - jsPDF и svg2pdf импортирует только движок `export/exportPdf.ts`;
 * - сам движок — только динамическим `import()` и только из загрузчика
 *   кнопки «Скачать PDF макета» (`ui/panel/maketExport.ts`): статический
 *   импорт утянул бы `vendor-pdf`
 *   в холст или оболочку (страж `bundle-budget` это ловит уже после сборки);
 * - у jsPDF — только `output('blob')`: никаких `html()`, `addJS`, вывода
 *   в новое окно и blob-URL; svg2pdf — без внешних таблиц стилей и только
 *   со встроенными картинками сцены.
 */
const rel = (p: string) => relative(SRC_DIR, p).split(sep).join('/');
const files = sourceFiles(SRC_DIR).map((p) => ({ rel: rel(p), text: readSource(p) }));
const ENGINE = 'orderstudio/design/export/exportPdf.ts';
/** Загрузчик движка кнопки «Скачать PDF макета» */
const LOADER = 'orderstudio/design/ui/panel/maketExport.ts';

/** Импорт из модуля: статический (`from '…'`, `import '…'`) и динамический (`import('…')`) */
function imports(text: string): { spec: string; dynamic: boolean }[] {
  const re = /(?:from\s+|import\s*(\()\s*|import\s+)(['"])([^'"]+)\2/g;
  return [...text.matchAll(re)].map((m) => ({ spec: m[3], dynamic: Boolean(m[1]) }));
}

const PDF_LIBS = /^(jspdf|svg2pdf\.js)(\/|$)/;
const ENGINE_SPEC = /(^|\/)export\/exportPdf$|^\.\/exportPdf$/;
const BAD_JSPDF = /\.html\s*\(|\baddJS\b|\.output\(\s*(?!['"]blob['"]\s*\))/;

describe('сторожа PDF макета', () => {
  it('обход видит движок и кнопку', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining([ENGINE, LOADER]));
  });

  it('jsPDF и svg2pdf — только в движке', () => {
    const bad = files.flatMap((f) => imports(f.text).filter((i) => PDF_LIBS.test(i.spec)).map(() => f.rel));
    expect([...new Set(bad)]).toEqual([ENGINE]);
  });

  it('движок — только динамически и только из загрузчика кнопки', () => {
    // Тип `typeof import('…/exportPdf')` тоже совпадает с `import(` — по файлу и виду импорта считаем один раз
    const users = files.flatMap((f) => imports(f.text).filter((i) => ENGINE_SPEC.test(i.spec)).map((i) => `${f.rel} ${i.dynamic ? 'import()' : 'static'}`));
    expect([...new Set(users)]).toEqual([`${LOADER} import()`]);
  });

  it('jsPDF: только output(\'blob\'), без html(), addJS и вывода в окно', () => {
    const design = files.filter((f) => f.rel.startsWith('orderstudio/design/'));
    expect(design.filter((f) => BAD_JSPDF.test(f.text)).map((f) => f.rel)).toEqual([]);
    expect(readSource(join(SRC_DIR, ENGINE))).toMatch(/\.output\('blob'\)/);
  });

  it('svg2pdf: без внешних таблиц стилей, картинки — только data:image PNG/SVG', () => {
    const engine = readSource(join(SRC_DIR, ENGINE));
    const call = engine.match(/svg2pdf\(el, pdf, \{([^}]*)\}\)/)?.[1] ?? '';
    expect(call).toMatch(/loadExternalStyleSheets: false/);
    expect(call).toMatch(/loadImages: SCENE_IMAGES/);
    expect(engine).toMatch(/const SCENE_IMAGES = \/\^data:image\\\/\(png\|svg\\\+xml\);base64,\//);
  });

  it('проверки ловят то, что должны (мутация на строке)', () => {
    expect(imports("const m = await import('../../export/exportPdf');")).toEqual([{ spec: '../../export/exportPdf', dynamic: true }]);
    expect(imports("import { exportMaketPdf } from '../../export/exportPdf';")).toEqual([{ spec: '../../export/exportPdf', dynamic: false }]);
    expect(imports("import 'svg2pdf.js';").some((i) => PDF_LIBS.test(i.spec))).toBe(true);
    for (const bad of ["pdf.html(el)", "pdf.addJS('x')", "pdf.output('bloburl')", "pdf.output('dataurlnewwindow')", 'pdf.output()']) {
      expect(BAD_JSPDF.test(bad), bad).toBe(true);
    }
    expect(BAD_JSPDF.test("pdf.output('blob')")).toBe(false);
  });
});
