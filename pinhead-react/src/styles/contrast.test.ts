import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Контраст текстовых токенов по WCAG 2.1 — машиной, а не глазами.
 *
 * История: аудит 03.08.2026 нашёл, что `--text-muted` не проходил AA НИ НА ОДНОМ
 * фоне светлой темы (3.54 на карточке, 2.81 на `--bg3` при норме 4.5), а
 * `--text-dim` в тёмной проходил на `--card` (4.70) и не проходил на `--surface`
 * (4.32). Именно поэтому жалоба звучала как «местами уходит ниже»: один токен
 * на разных поверхностях вёл себя по-разному, и правка «по местам» не кончилась
 * бы никогда.
 *
 * Тест читает НАСТОЯЩИЙ index.css, а не копию значений: копия разошлась бы
 * с источником при первой же правке палитры и тихо охраняла бы прошлое.
 */

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
  'utf8',
);

/** Норма WCAG AA для обычного текста */
const AA = 4.5;

/** Значение токена внутри блока (`:root` или `html[data-theme="dark"]`) */
function tokenValue(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`токен --${name} не найден`);
  return m[1].trim();
}

/** Блок объявлений темы из index.css */
function themeBlock(theme: 'light' | 'dark'): string {
  const start = theme === 'light'
    ? CSS.indexOf(':root {')
    : CSS.indexOf('html[data-theme="dark"] {');
  if (start < 0) throw new Error(`блок темы ${theme} не найден`);
  const end = CSS.indexOf('\n}', start);
  return CSS.slice(start, end);
}

/** Разворачиваем var(--x) — токены-алиасы должны проверяться по конечному цвету */
function resolve(block: string, value: string, depth = 0): string {
  const m = value.match(/^var\(\s*--([\w-]+)\s*\)$/);
  if (!m) return value;
  if (depth > 5) throw new Error(`цепочка var() слишком длинная: ${value}`);
  return resolve(block, tokenValue(block, m[1]), depth + 1);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Фоны, на которых текст реально печатается (заливки поверхностей) */
const SURFACES = ['bg', 'bg1', 'bg3', 'card', 'surface'];
/** Токены текста, которые обязаны проходить AA на любой поверхности */
const TEXTS = ['text', 'text-secondary', 'text-mid', 'text-dim', 'text-muted'];

describe.each(['light', 'dark'] as const)('контраст текстовых токенов — %s', (theme) => {
  const block = themeBlock(theme);
  const color = (name: string) => resolve(block, tokenValue(block, name));

  it.each(TEXTS)('--%s проходит AA на всех поверхностях', (text) => {
    const fg = color(text);
    const failures = SURFACES
      .map((s) => ({ surface: s, ratio: contrast(fg, color(s)) }))
      .filter((r) => r.ratio < AA)
      .map((r) => `--${r.surface}: ${r.ratio.toFixed(2)}`);
    expect(failures, `--${text} (${fg}) ниже ${AA}:1 на ${failures.join(', ')}`).toEqual([]);
  });
});

describe('семантические токены-заливки несут текст своего ink-цвета', () => {
  // Правило проекта: заливка --color-*, текст на ней --color-*-ink.
  // Красить текст той же переменной, что заливку, нельзя — в светлой теме
  // «ожидает» давало 2.02:1.
  const light = themeBlock('light');
  const color = (name: string) => resolve(light, tokenValue(light, name));

  it.each(['success', 'error', 'warning'])('--color-%s-ink читаем на белом', (kind) => {
    const ratio = contrast(color(`color-${kind}-ink`), color('card'));
    expect(ratio, `--color-${kind}-ink даёт ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
  });
});

/**
 * Палитра ERP проверялась НЕ БОЛЬШЕ, ЧЕМ КОММЕНТАРИЕМ.
 *
 * `.shell` переопределяет 37 токенов в светлой теме и 34 в тёмной — то есть
 * весь раздел «Производство» работает на цветах, которых этот тест не видел
 * вовсе: он читал только `index.css`. Единственной проверкой была фраза
 * в `erp.module.css` о том, что один синий «чуть ниже нормы».
 *
 * Чипы статусов — главный быстрый сигнал для цеха: пара «заливка --bg-*,
 * текст --color-*-ink». Именно на ней и ловились в прошлый раз (2.02:1
 * у «ожидает» в светлой теме).
 */
const ERP_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'erp', 'erp.module.css'),
  'utf8',
);

/** Блок палитры ERP: `:global(html) .shell` / `:global(html[data-theme='dark']) .shell` */
function shellBlock(theme: 'light' | 'dark'): string {
  const marker = theme === 'light'
    ? ':global(html) .shell {'
    : ":global(html[data-theme='dark']) .shell {";
  const start = ERP_CSS.indexOf(marker);
  if (start < 0) throw new Error(`палитра .shell (${theme}) не найдена`);
  const end = ERP_CSS.indexOf('\n}', start);
  return ERP_CSS.slice(start, end);
}

/** Чип статуса: подложка → цвет текста на ней */
const CHIPS: Array<[bg: string, ink: string]> = [
  ['bg-success', 'color-success-ink'],
  ['bg-error', 'color-error-ink'],
  ['bg-warning', 'color-warning-ink'],
  ['bg-info', 'color-info-ink'],
  ['bg-violet', 'color-violet-ink'],
  ['bg-cyan', 'color-cyan-ink'],
];

describe.each(['light', 'dark'] as const)('чипы статусов ERP — %s', (theme) => {
  const block = shellBlock(theme);
  const color = (name: string) => resolve(block, tokenValue(block, name));

  it.each(CHIPS)('текст --%s → --%s проходит AA', (bg, ink) => {
    const ratio = contrast(color(ink), color(bg));
    expect(
      ratio,
      `--${ink} (${color(ink)}) на --${bg} (${color(bg)}) даёт ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA);
  });
});
