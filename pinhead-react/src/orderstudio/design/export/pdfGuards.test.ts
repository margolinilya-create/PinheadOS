// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторожа PDF (веха 5а, задача 7; веха 6+7, задача 3 — К5; проверка
 * безопасности H1, L6; Review Focus 5 и 6):
 * - jsPDF и svg2pdf импортирует только общее ядро `design/export/pdfCore.ts`;
 * - ядро статически импортируют ровно два движка — PDF макета (`exportPdf.ts`)
 *   и PDF ТЗ (`tz/pdf/*`);
 * - движки — только динамическим `import()` и только из своих загрузчиков:
 *   `exportPdf` — из `design/ui/panel/maketExport.ts`, `tzPdf` — из
 *   `tz/ui/tzExport.ts`; прочие модули `tz/pdf/` — только из `tz/pdf/`
 *   (кроме `tzPdfError` без импортов). Статический импорт утянул бы
 *   `vendor-pdf` в холст или оболочку;
 * - у jsPDF — только `output('blob')` (`pdfBlob`): никаких `html()`, `addJS`,
 *   вывода в окно и blob-URL; svg2pdf — без внешних таблиц стилей и только
 *   со встроенными картинками сцены;
 * - ссылка в PDF ТЗ (`textWithLink`, `link`) — только рядом с `isSafeHttpUrl`.
 */
const rel = (p: string) => relative(SRC_DIR, p).split(sep).join('/');
const files = sourceFiles(SRC_DIR).map((p) => ({ rel: rel(p), text: readSource(p) }));
const CORE = 'orderstudio/design/export/pdfCore.ts';
const MAKET = 'orderstudio/design/export/exportPdf.ts';
const TZ_ENGINE = 'orderstudio/tz/pdf/tzPdf.ts';
const TZ_PDF_DIR = 'orderstudio/tz/pdf/';
/** Загрузчик движка кнопки «Скачать PDF макета» */
const MAKET_LOADER = 'orderstudio/design/ui/panel/maketExport.ts';
/** Загрузчик движка PDF ТЗ */
const TZ_LOADER = 'orderstudio/tz/ui/tzExport.ts';
/** Лёгкий модуль без импортов: экран отличает отказ, не загружая движок */
const TZ_ERROR = 'orderstudio/tz/pdf/tzPdfError.ts';

/** Импорт из модуля: статический (`from '…'`, `import '…'`) и динамический (`import('…')`) */
function imports(text: string): { spec: string; dynamic: boolean }[] {
  const re = /(?:from\s+|import\s*(\()\s*|import\s+)(['"])([^'"]+)\2/g;
  return [...text.matchAll(re)].map((m) => ({ spec: m[3], dynamic: Boolean(m[1]) }));
}

const PDF_LIBS = /^(jspdf|svg2pdf\.js)(\/|$)/;
const CORE_SPEC = /(^|\/)pdfCore$/;
const MAKET_SPEC = /(^|\/)export\/exportPdf$|^\.\/exportPdf$/;
const TZ_ENGINE_SPEC = /(^|\/)tzPdf$/;
/** Модули `tz/pdf/` по спецификатору (кроме модуля ошибки) */
const TZ_PDF_SPEC = /(^|\/)(pdf\/)?(drawBoxes|tzImages)$/;
const BAD_JSPDF = /\.html\s*\(|\baddJS\b|\.output\(\s*(?!['"]blob['"]\s*\))/;
const LINK_CALL = /\btextWithLink\s*\(|\.link\s*\(/g;
/** Окно перед вызовом ссылки, где обязана стоять проверка */
const LINK_WINDOW = 160;

/** Кто импортирует модули по спецификатору: «файл вид» без повторов */
function usersOf(spec: RegExp): string[] {
  return [...new Set(files.flatMap((f) => imports(f.text).filter((i) => spec.test(i.spec)).map((i) => `${f.rel} ${i.dynamic ? 'import()' : 'static'}`)))].sort();
}

/** Вызовы ссылки без `isSafeHttpUrl(` в окне перед ними */
function unsafeLinks(text: string): number {
  return [...text.matchAll(LINK_CALL)].filter((m) => !text.slice(Math.max(0, (m.index ?? 0) - LINK_WINDOW), m.index).includes('isSafeHttpUrl(')).length;
}

describe('сторожа PDF макета и ТЗ', () => {
  it('обход видит ядро, движки и загрузчики', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining([CORE, MAKET, TZ_ENGINE, MAKET_LOADER, TZ_LOADER, TZ_ERROR]));
  });

  it('jsPDF и svg2pdf — только в ядре pdfCore', () => {
    const bad = files.flatMap((f) => imports(f.text).filter((i) => PDF_LIBS.test(i.spec)).map(() => f.rel));
    expect([...new Set(bad)]).toEqual([CORE]);
  });

  it('ядро статически импортируют только движок макета и модули tz/pdf', () => {
    const users = usersOf(CORE_SPEC);
    expect(users.every((u) => u.endsWith(' static'))).toBe(true);
    const owners = users.map((u) => u.split(' ')[0]);
    expect(owners).toContain(MAKET);
    expect(owners).toContain(TZ_ENGINE);
    expect(owners.filter((o) => o !== MAKET && !o.startsWith(TZ_PDF_DIR))).toEqual([]);
  });

  it('движок макета — только import() из загрузчика кнопки', () => {
    // Тип `typeof import('…/exportPdf')` тоже совпадает с `import(` — по файлу и виду импорта считаем один раз
    expect(usersOf(MAKET_SPEC)).toEqual([`${MAKET_LOADER} import()`]);
  });

  it('движок ТЗ — только import() из tzExport; drawBoxes и tzImages — только из tz/pdf', () => {
    expect(usersOf(TZ_ENGINE_SPEC)).toEqual([`${TZ_LOADER} import()`]);
    expect(usersOf(TZ_PDF_SPEC).filter((u) => !u.startsWith(TZ_PDF_DIR))).toEqual([]);
    expect(imports(readSource(join(SRC_DIR, TZ_ERROR)))).toEqual([]);
  });

  it('jsPDF: только output(\'blob\'), без html(), addJS и вывода в окно — в design/** и tz/**', () => {
    const pdfDirs = files.filter((f) => f.rel.startsWith('orderstudio/design/') || f.rel.startsWith('orderstudio/tz/'));
    expect(pdfDirs.filter((f) => BAD_JSPDF.test(f.text)).map((f) => f.rel)).toEqual([]);
    expect(readSource(join(SRC_DIR, CORE))).toMatch(/\.output\('blob'\)/);
  });

  it('svg2pdf: без внешних таблиц стилей, картинки — только data:image PNG/SVG', () => {
    const core = readSource(join(SRC_DIR, CORE));
    const calls = [...core.matchAll(/svg2pdf\(el, pdf, \{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/loadExternalStyleSheets: false/);
    expect(calls[0]).toMatch(/loadImages: SCENE_IMAGES/);
    expect(core).toMatch(/const SCENE_IMAGES = \/\^data:image\\\/\(png\|svg\\\+xml\);base64,\//);
  });

  it('ссылки в PDF ТЗ — только после isSafeHttpUrl', () => {
    const tz = files.filter((f) => f.rel.startsWith('orderstudio/tz/'));
    expect(tz.filter((f) => unsafeLinks(f.text) > 0).map((f) => f.rel)).toEqual([]);
    expect(readSource(join(SRC_DIR, TZ_PDF_DIR, 'drawBoxes.ts'))).toMatch(/textWithLink\(/);
  });

  it('проверки ловят то, что должны (мутации на строке)', () => {
    expect(imports("const m = await import('../../export/exportPdf');")).toEqual([{ spec: '../../export/exportPdf', dynamic: true }]);
    expect(imports("import { exportMaketPdf } from '../../export/exportPdf';")).toEqual([{ spec: '../../export/exportPdf', dynamic: false }]);
    expect(imports("import 'svg2pdf.js';").some((i) => PDF_LIBS.test(i.spec))).toBe(true);
    expect(imports("import { jsPDF } from 'jspdf';").some((i) => PDF_LIBS.test(i.spec))).toBe(true);
    expect(TZ_ENGINE_SPEC.test(imports("import { buildTzPdf } from '../../tz/pdf/tzPdf';")[0].spec)).toBe(true);
    expect(TZ_PDF_SPEC.test('../pdf/drawBoxes')).toBe(true);
    for (const bad of ["pdf.html(el)", "pdf.addJS('x')", "pdf.output('bloburl')", "pdf.output('dataurlnewwindow')", 'pdf.output()']) {
      expect(BAD_JSPDF.test(bad), bad).toBe(true);
    }
    expect(BAD_JSPDF.test("pdf.output('blob')")).toBe(false);
    expect(unsafeLinks("pdf.textWithLink(line, x, y, { url });")).toBe(1);
    expect(unsafeLinks("const url = isSafeHttpUrl(u) ? u : null;\nif (url) pdf.textWithLink(line, x, y, { url });")).toBe(0);
    expect(unsafeLinks("pdf.link(x, y, w, h, { url });")).toBe(1);
  });
});
