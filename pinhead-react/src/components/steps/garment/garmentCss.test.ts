// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Панели «Изделия» (веха 8, задача 6): `styles/garment.css` переехал в CSS-модули
 * панелей. Сторож держит то, что переезд обещал, и то, что легко вернуть правкой:
 *
 * - глобального `garment.css` нет и никто его не импортирует;
 * - в модулях нет `:global`, `!important`, фолбэков `var(--x, X)` и цветов
 *   литералом — цвета только токенами (иначе тёмная тема снова «забывает» панель);
 * - кегль — только ступенью шкалы и не мельче 12 px (подписи образца были 9 px);
 * - тач-цели — токеном `--control-h-md` на `pointer: coarse` (44 px), а не
 *   `:global`-переопределениями в `Workplace.module.css`;
 * - палитра на телефоне без вложенной прокрутки (она «ловит» палец);
 * - образец: одна галочка (SVG в кружке), рамка и галочка — контрастными токенами
 *   в обеих темах, включая палитру оболочки раздела.
 */

const ROOT = process.cwd();
const DIR = join(ROOT, 'src/components/steps/garment');
const MODULES = ['panel', 'SkuList', 'FabricGrid', 'ColorPicker', 'SizeTable', 'ExtrasAccordion']
  .map((n) => join(DIR, `${n}.module.css`));

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (file: string) => strip(readFileSync(file, 'utf8'));

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...srcFiles(full));
    else if (/\.(jsx?|tsx?|css)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/** Тело первого блока `selector {…}` после позиции `from` (без вложенности) */
function block(css: string, selector: string, from = 0): string | null {
  const re = new RegExp(`(^|[}\\s,])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  re.lastIndex = from;
  const m = re.exec(css);
  return m ? m[2] : null;
}

/** Тело медиазапроса `@media <query> { … }` с вложенными блоками */
function media(css: string, query: RegExp): string[] {
  const out: string[] = [];
  const re = /@media\s*([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (!query.test(m[1])) continue;
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

describe('панели «Изделия» на CSS-модулях', () => {
  it('глобального garment.css нет и его не импортируют', () => {
    expect(existsSync(join(ROOT, 'src/styles/garment.css'))).toBe(false);
    const importers = srcFiles(join(ROOT, 'src'))
      .filter((f) => /garment\.css['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(importers).toEqual([]);
  });

  it('модули на месте и не больше 400 строк', () => {
    for (const f of MODULES) {
      expect(existsSync(f), f).toBe(true);
      expect(readFileSync(f, 'utf8').split('\n').length, f).toBeLessThanOrEqual(400);
    }
  });

  it('нет :global, !important, фолбэков и цветов литералом', () => {
    const bad: string[] = [];
    for (const f of MODULES) {
      const css = read(f);
      const name = f.slice(DIR.length + 1);
      if (/:global/.test(css)) bad.push(`${name}: :global`);
      if (/!important/.test(css)) bad.push(`${name}: !important`);
      for (const m of css.matchAll(/var\((--[\w-]+)\s*,/g)) bad.push(`${name}: фолбэк ${m[1]}`);
      for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)) bad.push(`${name}: цвет литералом ${m[0]}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('кегль — только ступенью шкалы, не мельче 12 px', () => {
    const index = strip(readFileSync(join(ROOT, 'src/index.css'), 'utf8'));
    const scale = new Map([...index.matchAll(/(--type-[\w-]+):\s*(\d+(?:\.\d+)?)px/g)].map((m) => [m[1], Number(m[2])]));
    const bad: string[] = [];
    for (const f of MODULES) {
      for (const m of read(f).matchAll(/font-size:\s*([^;}]+)/g)) {
        const tok = /^var\((--type-[\w-]+)\)$/.exec(m[1].trim());
        const px = tok ? scale.get(tok[1]) : undefined;
        if (px === undefined || px < 12) bad.push(`${f.slice(DIR.length + 1)}: font-size ${m[1].trim()}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('тач-цели — токеном --control-h-md на pointer: coarse (44 px)', () => {
    const index = strip(readFileSync(join(ROOT, 'src/index.css'), 'utf8'));
    const coarse = media(index, /pointer:\s*coarse/).join('\n');
    expect(coarse).toMatch(/--control-h-md:\s*44px/);
    for (const n of ['SkuList', 'FabricGrid', 'ColorPicker', 'SizeTable', 'ExtrasAccordion']) {
      const css = read(join(DIR, `${n}.module.css`));
      expect(media(css, /pointer:\s*coarse/).join('\n'), n).toMatch(/var\(--control-h-md\)/);
    }
  });

  it('Workplace.module.css больше не переопределяет панели через :global', () => {
    const css = read(join(ROOT, 'src/orderstudio/workplace/Workplace.module.css'));
    expect(css).not.toMatch(/:global\(\.(qty-|swatch|garment-|sku-|fit-|extras-|add-size|btn-add-size|btn-cancel-size|color-search|size-rm|supplier-tab)/);
  });
});

describe('палитра цвета', () => {
  const css = read(join(DIR, 'ColorPicker.module.css'));

  it('на ≤ 760 px нет вложенной прокрутки палитры', () => {
    const phone = media(css, /max-width:\s*760px/).join('\n');
    const swatches = block(phone, '.swatches');
    expect(swatches).not.toBeNull();
    expect(swatches).toMatch(/max-height:\s*none/);
    expect(swatches).toMatch(/overflow(-y)?:\s*visible/);
  });

  it('галочка одна: без ::after-глифа, кружок токенами', () => {
    expect(css).not.toMatch(/\\2713|::after/);
    const check = block(css, '.check');
    expect(check).toMatch(/background:\s*var\(--black\)/);
    expect(check).toMatch(/border:\s*\d+px solid var\(--white\)/);
    expect(check).toMatch(/color:\s*var\(--white\)/);
  });

  it('рамка образца и кольцо выбранного — токенами', () => {
    expect(block(css, '.circle')).toMatch(/border:\s*1px solid var\(--border-control\)/);
    expect(css).toMatch(/\.selected \.circle\s*\{[^}]*var\(--accent\)/);
  });

  it('подпись образца — в две строки с line-clamp', () => {
    const label = block(css, '.label');
    expect(label).toMatch(/-webkit-line-clamp:\s*2/);
    expect(label).toMatch(/line-clamp:\s*2/);
  });
});

/* ── Контраст по токенам (как в ERP: `styles/contrast.test.ts`) ── */

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const ch = (i: number) => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const INDEX = strip(readFileSync(join(ROOT, 'src/index.css'), 'utf8'));
const SHELL = strip(readFileSync(join(ROOT, 'src/orderstudio/layout/OrderLayout.module.css'), 'utf8'));

function blockAt(css: string, marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`нет блока ${marker}`);
  return css.slice(start, css.indexOf('\n}', start));
}
const tokenIn = (b: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(b)?.[1];

/** Палитра темы: оболочка раздела поверх index.css (то, что видит рабочее место) */
function palette(theme: 'light' | 'dark') {
  const root = blockAt(INDEX, theme === 'light' ? ':root {' : 'html[data-theme="dark"] {');
  const rootLight = blockAt(INDEX, ':root {');
  const shell = blockAt(SHELL, theme === 'light' ? ':global(html) .shell {' : ":global(html[data-theme='dark']) .shell {");
  const get = (name: string, layered: boolean) => {
    const v = (layered ? tokenIn(shell, name) : undefined) ?? tokenIn(root, name) ?? tokenIn(rootLight, name);
    if (!v) throw new Error(`токен --${name} (${theme}) не найден`);
    return v;
  };
  return { get };
}

/** Белая и тёмная ткань: крайние цвета, на которых образец обязан читаться */
const FABRICS = ['#FFFFFF', '#000000'];

describe.each(['light', 'dark'] as const)('контраст образца — %s', (theme) => {
  const { get } = palette(theme);

  it.each([true, false])('рамка образца ≥ 3:1 к фонам панели (оболочка раздела: %s)', (layered) => {
    const border = get('border-control', layered);
    for (const bg of ['card', 'surface', 'bg']) {
      const ratio = contrast(border, get(bg, layered));
      expect(ratio, `--border-control ${border} на --${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('выбранный белый и чёрный цвет: галочка к фону ≥ 3:1', () => {
    const fill = get('black', false);
    const ring = get('white', false);
    // Кружок галочки или его обводка контрастны к ткани любого цвета
    for (const fabric of FABRICS) {
      const best = Math.max(contrast(fill, fabric), contrast(ring, fabric));
      expect(best, `галочка на ткани ${fabric}: ${best.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
    // Белая ткань — прямо тот случай, где белая галочка пропадала
    expect(contrast(fill, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    // Сама галочка на своём кружке
    expect(contrast(ring, fill)).toBeGreaterThanOrEqual(4.5);
  });
});
