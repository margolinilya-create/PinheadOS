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

/**
 * ТЕКСТ НА ПОВЕРХНОСТЯХ САМОЙ ПАЛИТРЫ РАЗДЕЛА (аудит 03.09).
 *
 * Матрица «текст × поверхность» выше читает `themeBlock()`, то есть
 * `index.css`. А раздел «Производство» переопределяет и текстовые токены,
 * и поверхности — и провал жил ровно там: `--text-dim` = `#6B7280` давал
 * 4.39:1 на `--surface` и 4.47:1 на `--bg` при норме 4.5. Сторож, написанный
 * ИМЕННО ради этого класса дефектов, не видел его по построению: чипы он
 * проверял, обычный текст на обычном фоне — нет.
 */
describe.each(['light', 'dark'] as const)('контраст текста палитры ERP — %s', (theme) => {
  const block = shellBlock(theme);
  const color = (name: string) => resolve(block, tokenValue(block, name));

  it.each(['text', 'text-mid', 'text-dim', 'text-muted'])(
    '--%s проходит AA на всех поверхностях .shell',
    (text) => {
      const fg = color(text);
      const failures = ['bg', 'card', 'surface']
        .map((s2) => ({ surface: s2, ratio: contrast(fg, color(s2)) }))
        .filter((r) => r.ratio < AA)
        .map((r) => `--${r.surface}: ${r.ratio.toFixed(2)}`);
      expect(failures, `--${text} (${fg}) ниже ${AA}:1 на ${failures.join(', ')}`).toEqual([]);
    },
  );
});

/**
 * НЕТЕКСТОВЫЙ КОНТРАСТ: границы элементов управления (WCAG 1.4.11, норма 3:1).
 *
 * Поле ввода отличается от фона страницы фоном на 1.04:1 — значит его рамка
 * и есть единственная граница. Прежняя `--border` `#E5E7EB` давала 1.24:1:
 * на цеховом планшете под ярким светом не видно, куда печатать. Проверка
 * заведена вместе с токеном `--border-control`.
 */
const NON_TEXT_AA = 3;

describe.each(['light', 'dark'] as const)('границы элементов управления ERP — %s', (theme) => {
  const block = shellBlock(theme);
  const color = (name: string) => resolve(block, tokenValue(block, name));

  it.each(['card', 'bg', 'surface'])('--border-control различима на --%s', (surface) => {
    const ratio = contrast(color('border-control'), color(surface));
    expect(
      ratio,
      `--border-control (${color('border-control')}) на --${surface} даёт ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });
});

/**
 * ЗАЛИВКА ОПАСНОЙ КНОПКИ ПОД СВОИМ ТЕКСТОМ.
 *
 * `.danger` красился `--color-error` под белым: 3.76:1 в светлой теме и 2.77:1
 * в тёмной (там токен светлый) — обе ниже AA. Пара вынесена в собственные
 * токены, и проверяется она как пара, а не по отдельности.
 */
describe.each(['light', 'dark'] as const)('кнопка опасного действия — %s', (theme) => {
  const block = shellBlock(theme);
  const color = (name: string) => resolve(block, tokenValue(block, name));

  it('текст на заливке проходит AA', () => {
    const ratio = contrast(color('btn-danger-fg'), color('btn-danger-bg'));
    expect(ratio, `${color('btn-danger-fg')} на ${color('btn-danger-bg')} даёт ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA);
  });
});
