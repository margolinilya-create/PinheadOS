// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторожа файлов холста (веха 5а, задача 5; проверка безопасности H2, L5–L7,
 * бюджет задачи 0):
 * - **pdfjs — только в `assets/loadPdf.ts`**, а сам `loadPdf` — только
 *   динамическим `import()`: иначе `vendor-pdfjs` (≈ 99 кБ) уехал бы в холст
 *   или в оболочку;
 * - **object URL в `design/**` создают только кэши картинок**
 *   (`artworkImages`, `flatImages`) — там Blob уже чистый (тип по байтам,
 *   SVG после санитайзера) и URL уходит только в `HTMLImageElement`; в этих
 *   файлах нет `href`. Новое место с object URL (например, сохранение PDF
 *   макета) добавляется сюда осознанно, с обоснованием;
 * - **подписанные ссылки на холст не идут** — только `downloadArtwork` → Blob;
 * - **zod — только `zod/mini`** (решение задачи 0: полный zod +19 кБ в холсте).
 */
const DESIGN_DIR = join(SRC_DIR, 'orderstudio', 'design');
const rel = (f: string, base: string) => relative(base, f).split(sep).join('/');
const all = sourceFiles().map((f) => ({ rel: rel(f, SRC_DIR), text: readSource(f) }));
const design = sourceFiles(DESIGN_DIR).map((f) => ({ rel: rel(f, DESIGN_DIR), text: readSource(f) }));

/** Статические спецификаторы: `from '…'`, `import '…'` (без динамического `import(`) */
function staticSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\s+)(['"])([^'"]+)\1/g)].map((m) => m[2]);
}
function allSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g)].map((m) => m[2]);
}
/** Код без комментариев — чтобы пояснения в шапках не срабатывали */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const OBJECT_URL_FILES = ['assets/artworkImages.ts', 'assets/flatImages.ts'];

describe('сторожа файлов холста', () => {
  it('pdfjs-dist импортирует только assets/loadPdf.ts', () => {
    const bad = all
      .filter((f) => f.rel !== 'orderstudio/design/assets/loadPdf.ts')
      .filter((f) => allSpecifiers(f.text).some((s) => s.startsWith('pdfjs-dist')))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
    expect(design.find((f) => f.rel === 'assets/loadPdf.ts')?.text).toMatch(/from 'pdfjs-dist\/build\/pdf\.mjs'/);
  });

  it('loadPdf нигде не импортируется статически — только import()', () => {
    const bad = all
      .filter((f) => staticSpecifiers(f.text).some((s) => /(^|\/)loadPdf$/.test(s)))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
    expect(all.some((f) => /import\(\s*['"][./]*(?:[^'"]*\/)?loadPdf['"]\s*\)/.test(f.text))).toBe(true);
  });

  it('object URL создают только кэши картинок, и в них нет href', () => {
    const creators = design.filter((f) => /createObjectURL/.test(code(f.text))).map((f) => f.rel).sort();
    expect(creators).toEqual(OBJECT_URL_FILES);
    for (const f of design.filter((x) => OBJECT_URL_FILES.includes(x.rel))) expect(code(f.text), f.rel).not.toMatch(/\bhref\b/);
  });

  it('подписанные ссылки на холст не идут', () => {
    const bad = design.filter((f) => /createSignedUrls?\b|artworkSignedUrls?\b|artworkDownloadUrl\b/.test(code(f.text))).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it('zod — только zod/mini', () => {
    const bad = design.filter((f) => allSpecifiers(f.text).some((s) => s === 'zod' || s.startsWith('zod/') && s !== 'zod/mini')).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it('самопроверка: образцы ловятся', () => {
    expect(staticSpecifiers("import { loadPdf } from './loadPdf';")).toEqual(['./loadPdf']);
    expect(staticSpecifiers("const m = await import('./loadPdf');")).toEqual([]);
    expect(allSpecifiers("const m = await import('pdfjs-dist');")).toEqual(['pdfjs-dist']);
    expect(code('// URL.createObjectURL(x)\nconst a = 1;')).not.toMatch(/createObjectURL/);
    expect(code('a.href = URL.createObjectURL(b);')).toMatch(/\bhref\b/);
  });
});
