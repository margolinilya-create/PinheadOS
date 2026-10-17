// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторож konva (веха 5а, задача 6а; замер задачи 0 в `design/README.md`):
 * - konva и react-konva импортирует ТОЛЬКО `design/ui/konva.ts` — иначе
 *   полный пакет (все фигуры) мог бы приехать в чанк холста мимо Core-подпутей,
 *   а то и в оболочку;
 * - в `konva.ts` — только Core-подпути и фигуры из белого списка; `Arrow`
 *   запрещён (+8,5 кБ gzip, потолок холста 100 кБ).
 */
const KONVA_FILE = 'orderstudio/design/ui/konva.ts';
/** Ядро konva без анимаций — подмена `konva/lib/Core` в `vite.config.js` (раунд 1 ревью 6б) */
const CORE_FILE = 'orderstudio/design/ui/konvaCore.ts';
const CORE_ALLOWED = new Set([
  'konva/lib/Global', 'konva/lib/Util', 'konva/lib/Node', 'konva/lib/Container', 'konva/lib/Stage',
  'konva/lib/Layer', 'konva/lib/Group', 'konva/lib/DragAndDrop', 'konva/lib/Shape', 'konva/lib/Context',
  'konva/lib/Canvas',
]);
const files = sourceFiles(SRC_DIR).map((f) => ({ rel: relative(SRC_DIR, f).split(sep).join('/'), text: readSource(f) }));

function specifiers(text: string): string[] {
  const re = /(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g;
  return [...text.matchAll(re)].map((m) => m[2]);
}

const isKonva = (s: string) => /^(react-)?konva(\/|$)/.test(s);
const ALLOWED = new Set([
  'konva/lib/shapes/Image',
  'konva/lib/shapes/Rect',
  'konva/lib/shapes/Line',
  'konva/lib/shapes/Text',
  'konva/lib/shapes/Transformer',
  'react-konva/lib/ReactKonvaCore',
]);

describe('сторож konva', () => {
  it('обход видит модуль konva', () => {
    expect(files.some((f) => f.rel === KONVA_FILE)).toBe(true);
  });

  it('konva и react-konva импортирует только design/ui/konva.ts (тесты подменяют его, а не пакет)', () => {
    const bad = files
      .filter((f) => f.rel !== KONVA_FILE && f.rel !== CORE_FILE)
      .flatMap((f) => specifiers(f.text).filter(isKonva).map((s) => `${f.rel}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('в konva.ts — только Core-подпути и фигуры из белого списка, без Arrow', () => {
    const text = files.find((f) => f.rel === KONVA_FILE)!.text;
    const used = specifiers(text).filter(isKonva);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((s) => !ALLOWED.has(s))).toEqual([]);
    expect(text).not.toMatch(/export\s*\{[^}]*\bArrow\b/);
  });

  it('ядро konvaCore.ts — только внутренние модули ядра, без Tween/Animation/FastLayer', () => {
    const text = files.find((f) => f.rel === CORE_FILE)!.text;
    const used = specifiers(text).filter(isKonva);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((s) => !CORE_ALLOWED.has(s))).toEqual([]);
  });

  it('vite.config.js подменяет konva/lib/Core на konvaCore.ts', () => {
    const config = readFileSync(join(SRC_DIR, '..', 'vite.config.js'), 'utf8');
    expect(config).toMatch(/find: \/\^konva\\\/lib\\\/Core\(\\\.js\)\?\$\//);
    expect(config).toContain("./src/orderstudio/design/ui/konvaCore.ts");
  });

  it('проверка ловит то, что должна (мутация на строке)', () => {
    expect(specifiers("import Konva from 'konva';").filter(isKonva)).toEqual(['konva']);
    expect(specifiers("import { Stage } from 'react-konva';").filter((s) => !ALLOWED.has(s))).toEqual(['react-konva']);
    expect(ALLOWED.has('konva/lib/shapes/Arrow')).toBe(false);
    expect(CORE_ALLOWED.has('konva/lib/Tween')).toBe(false);
    expect(CORE_ALLOWED.has('konva/lib/Animation')).toBe(false);
    expect("export { Stage, Arrow } from 'react-konva/lib/ReactKonvaCore';").toMatch(/export\s*\{[^}]*\bArrow\b/);
  });
});
