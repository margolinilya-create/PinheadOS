// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource, SRC_DIR } from '../../../../testutil/sourceFiles';
import { DEFAULT_TOKENS, TOKEN_NAMES, type CanvasTokens } from './useCanvasTokens';

/**
 * Сторож стилей холста редактора флэта (веха 5б, задача 6а; проверка скиллами —
 * доступность: «контраст ≥ 3:1 с тестом, обе темы»).
 *
 * Палитра холста — токены `--flat-*` в `.root` модуля; значения `var(--x)`
 * разворачиваются по НАСТОЯЩЕЙ цепочке каскада отдельно для светлой и тёмной темы
 * и для двух мест холста: сам по себе (`index.css`) и внутри оболочки Order Studio —
 * снимок палитры `.shell` в `OrderLayout.module.css` перекрывает токены `index.css`
 * (в тёмной теме — светлыми …-ink: ревью 6а, раунд 1). Затем считаются пары WCAG: обводки зон, safe-зоны, якорей и отмера — к бумаге
 * и к силуэту (≥ 3:1, графика), подпись ручки — к её подложке (≥ 4,5:1, текст).
 * Плюс: значения по умолчанию хука (среда без CSS) совпадают с модулем, диктор — sr-only,
 * кольцо фокуса и жесты пальцем у области холста.
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const MODULE = strip(readSource(join(SRC_DIR, 'orderstudio', 'admin', 'flats', 'canvas', 'FlatCanvas.module.css')));
const INDEX = readSource(join(SRC_DIR, 'index.css'));
const SHELL = strip(readSource(join(SRC_DIR, 'orderstudio', 'layout', 'OrderLayout.module.css')));

const rule = (css: string, selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]']/g, '\\$&')}\\s*\\{[^}]*\\}`))?.[0] ?? '';

type Theme = 'light' | 'dark';
type Place = 'index' | 'shell';

function block(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`блок ${head} не найден`);
  return css.slice(start, css.indexOf('}', start));
}

const INDEX_LIGHT = block(INDEX, ':root {');
const INDEX_DARK = block(INDEX, 'html[data-theme="dark"] {');
const SHELL_LIGHT = block(SHELL, ':global(html) .shell {');
const SHELL_DARK = block(SHELL, ":global(html[data-theme='dark']) .shell {");

/** Блоки, где ищется токен, — от ближайшего к холсту (выигрывает первый найденный) */
function cascade(theme: Theme, place: Place): string[] {
  const index = theme === 'dark' ? [INDEX_DARK, INDEX_LIGHT] : [INDEX_LIGHT];
  if (place === 'index') return index;
  return [...(theme === 'dark' ? [SHELL_DARK] : []), SHELL_LIGHT, ...index];
}

function tokenValue(css: string, name: string): string | null {
  return css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? null;
}

/** Значение токена холста: `var(--x)` — по каскаду места и темы */
function resolve(value: string, theme: Theme, place: Place = 'index', depth = 0): string {
  const m = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!m) return value;
  if (depth > 5) throw new Error(`цепочка var() слишком длинная: ${value}`);
  let next: string | null = null;
  for (const b of cascade(theme, place)) {
    next = tokenValue(b, m[1]);
    if (next) break;
  }
  if (!next) throw new Error(`токен ${m[1]} не найден`);
  return resolve(next, theme, place, depth + 1);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = (i: number) => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const root = rule(MODULE, '.root');
const palette = (theme: Theme, place: Place = 'index'): CanvasTokens => {
  const out = {} as CanvasTokens;
  for (const [key, name] of Object.entries(TOKEN_NAMES) as [keyof CanvasTokens, string][]) {
    const raw = tokenValue(root, name);
    if (!raw) throw new Error(`в .root нет ${name}`);
    out[key] = resolve(raw, theme, place);
  }
  return out;
};

const STROKES: (keyof CanvasTokens)[] = ['zone', 'safe', 'axis', 'neck', 'calibrate'];
const GRAPHIC = 3;
const TEXT = 4.5;

const PLACES: [Theme, Place][] = [['light', 'index'], ['dark', 'index'], ['light', 'shell'], ['dark', 'shell']];

describe.each(PLACES)('палитра холста флэта — тема %s, каскад %s', (theme, place) => {
  const p = palette(theme, place);

  it('все токены — hex', () => {
    for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(STROKES)('обводка %s ≥ 3:1 к бумаге и к силуэту', (key) => {
    expect(contrast(p[key], p.paper), `${key} к бумаге`).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(p[key], p.garment), `${key} к силуэту`).toBeGreaterThanOrEqual(GRAPHIC);
  });

  it('подпись ручки ≥ 4,5:1 к подложке, к бумаге и к силуэту', () => {
    expect(contrast(p.label, p.halo)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.label, p.paper)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.label, p.garment)).toBeGreaterThanOrEqual(TEXT);
  });

  it('бумага светлая в обеих темах (как поле печати)', () => {
    expect(luminance(p.paper)).toBeGreaterThan(0.8);
  });
});

describe('FlatCanvas.module.css', () => {
  it('значения по умолчанию хука (среда без CSS) = светлая палитра модуля', () => {
    const light = palette('light');
    for (const key of Object.keys(DEFAULT_TOKENS) as (keyof CanvasTokens)[]) {
      expect(DEFAULT_TOKENS[key].toLowerCase(), key).toBe(light[key].toLowerCase());
    }
  });

  it('проверка контраста ловит то, что должна (мутация на значении)', () => {
    expect(contrast('#5B5BFF', '#d9d9d9')).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast('#cccccc', '#FDFAF3')).toBeLessThan(GRAPHIC);
    expect(resolve('var(--paper)', 'dark')).not.toBe(resolve('var(--paper)', 'light'));
    // Тёмная `.shell` перекрашивает …-ink: такой токен в палитре холста уронил бы контраст
    const ink = resolve('var(--color-success-ink)', 'dark', 'shell');
    expect(ink).not.toBe(resolve('var(--color-success-ink)', 'dark', 'index'));
    expect(contrast(ink, '#FDFAF3')).toBeLessThan(GRAPHIC);
  });

  it('диктор и подсказка — sr-only, а не display: none', () => {
    expect(rule(MODULE, '.srOnly')).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(MODULE).not.toMatch(/display:\s*none/);
  });

  it('кольцо фокуса и жесты пальцем у области холста', () => {
    expect(MODULE).toMatch(/\.canvas:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
    expect(rule(MODULE, '.canvas')).toMatch(/touch-action:\s*none/);
  });
});
