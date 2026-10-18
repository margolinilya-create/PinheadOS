// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Экспресс-расчёт на примитивах ERP (веха 8, задача 4). Сторож держит то, что
 * обещал рестайл, и то, что легко вернуть одной правкой:
 *
 * - глобального `styles/express.css` нет и его никто не импортирует;
 * - модуль `ExpressCalc.module.css` — только токены: нет `:global`, `!important`,
 *   фолбэков `var(--x, X)`, цветов литералом, кегля числом; не длиннее 400 строк;
 * - в разметке экрана нет инлайн-стилей (`style=`), глифов-стрелок и `<div onClick>`
 *   (выбор — только кнопками, иначе с клавиатуры не выбрать);
 * - размеры: `ExpressCalc.jsx` ≤ 250 строк, блоки `express/*.jsx` ≤ 200;
 * - бирок в экспрессе нет (К9 плана вехи 8): цена бирок v4 — `salesLabelPrice`.
 */
const EDITORS = join(SRC_DIR, 'components/editors');
const EXPRESS = join(EDITORS, 'express');
const MODULE = join(EDITORS, 'ExpressCalc.module.css');
const SCREEN = join(EDITORS, 'ExpressCalc.jsx');

const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (js: string) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').length;

const VIEW_FILES = [SCREEN, ...readdirSync(EXPRESS).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n)).map((n) => join(EXPRESS, n))];

/** Нарушения правил модуля CSS в тексте без комментариев */
function cssViolations(css: string): string[] {
  const text = stripCss(css);
  const bad: string[] = [];
  if (/:global/.test(text)) bad.push(':global');
  if (/!important/.test(text)) bad.push('!important');
  if (/var\(--[\w-]+\s*,/.test(text)) bad.push('фолбэк var(--x, X)');
  if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text)) bad.push('цвет литералом');
  for (const m of text.matchAll(/font-size:\s*([^;]+);/g)) {
    if (!/^var\(--type-[\w-]+\)$/.test(m[1].trim())) bad.push(`кегль ${m[1].trim()}`);
  }
  return bad;
}

/** Нарушения разметки экрана */
function viewViolations(code: string): string[] {
  const text = stripJs(code);
  const bad: string[] = [];
  if (/\bstyle=\{/.test(text)) bad.push('инлайн-стиль');
  if (/<div[^>]*\bonClick=/.test(text)) bad.push('<div onClick>');
  if (/[↓↑↻✕×]\s*</.test(text.replace(/×\s*\$\{/g, ''))) bad.push('глиф вместо Icon');
  if (/dangerouslySetInnerHTML|innerHTML/.test(text)) bad.push('HTML строкой');
  return bad;
}

describe('экспресс на примитивах ERP', () => {
  it('глобального express.css нет и его не импортируют', () => {
    expect(existsSync(join(SRC_DIR, 'styles/express.css'))).toBe(false);
    const importers = sourceFiles(SRC_DIR)
      .filter((f) => /express\.css['"]/.test(readSource(f)))
      .map((f) => f.slice(SRC_DIR.length + 1));
    expect(importers).toEqual([]);
  });

  it('сторож CSS видит нарушения (проверка самого сторожа)', () => {
    expect(cssViolations('.a { color: #fff; font-size: 13px; margin: var(--x, 4px) } :global(.b) { top: 0 !important }'))
      .toEqual([':global', '!important', 'фолбэк var(--x, X)', 'цвет литералом', 'кегль 13px']);
    expect(cssViolations('/* #fff 13px */ .a { color: var(--text); font-size: var(--type-label) }')).toEqual([]);
  });

  it('модуль экрана — только токены и не длиннее 400 строк', () => {
    expect(cssViolations(readFileSync(MODULE, 'utf8'))).toEqual([]);
    expect(lines(MODULE)).toBeLessThanOrEqual(400);
  });

  it('сторож разметки видит нарушения (проверка самого сторожа)', () => {
    expect(viewViolations('<div style={{ padding: 4 }} onClick={go}>✕</div>')).toEqual(['инлайн-стиль', '<div onClick>', 'глиф вместо Icon']);
    expect(viewViolations('<Button onClick={go}>Нанесение × {n}</Button> // style={{}}')).toEqual([]);
  });

  it('разметка экрана: без инлайн-стилей, <div onClick>, глифов и HTML строкой', () => {
    const bad = VIEW_FILES.flatMap((f) => viewViolations(readFileSync(f, 'utf8')).map((v) => `${f.slice(SRC_DIR.length + 1)}: ${v}`));
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('размеры: экран ≤ 250 строк, блоки ≤ 200', () => {
    expect(lines(SCREEN)).toBeLessThanOrEqual(250);
    for (const f of VIEW_FILES.filter((x) => x !== SCREEN)) expect(lines(f), f).toBeLessThanOrEqual(200);
  });

  it('бирок в экспрессе нет — и своей цены бирок тоже (К9)', () => {
    const code = VIEW_FILES.concat(join(EXPRESS, 'expressModel.ts')).map((f) => stripJs(readFileSync(f, 'utf8'))).join('\n');
    expect(code).not.toMatch(/labelPrice|careLabel|hangTag|labelConfig|ExpressLabels/);
  });
});
