import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ТЕНЬ И КОЛЬЦО ФОКУСА — ТОКЕНЫ, А НЕ ЗНАЧЕНИЯ ПО МЕСТУ.
 *
 * Тень отвечает на вопрос «на каком слое лежит эта поверхность», и ответ
 * у продукта должен быть один. До 12.09 токенов было два (`--shadow-card`,
 * `--shadow-modal`) при шести разовых значениях рядом — включая подъём
 * карточки под курсором, выписанный прямо у одной плитки обзора.
 * Такая тень «на один элемент» означает, что следующая карточка получит
 * свою, чуть другую, и слоёв станет столько же, сколько карточек.
 *
 * Отдельно — кольцо фокуса: пара `0 0 0 2px var(--card), 0 0 0 4px var(--accent)`
 * стояла ДОСЛОВНОЙ копией в трёх модулях примитивов. Кольцо фокуса это
 * не украшение, а единственный способ понять, где ты находишься, работая
 * с клавиатуры; три копии одного правила расходятся молча.
 *
 * ИСКЛЮЧЕНИЯ ПЕРЕЧИСЛЕНЫ ПОИМЁННО И С ПРИЧИНОЙ — не всякий `box-shadow`
 * является тенью слоя: бывает оттиск краски и кольцо-индикатор.
 */

const CSS = [
  'src/erp/erp.module.css',
  'src/erp/screens.module.css',
  'src/erp/components/Button.module.css',
  'src/erp/components/Field.module.css',
  'src/erp/components/States.module.css',
];

/**
 * Значения, которые тенью слоя НЕ являются. Ключ — подстрока значения,
 * значение — почему это законно.
 */
const ALLOWED: Record<string, string> = {
  '2px 2px 0 rgba(123, 123, 255': 'оттиск краски у логотипа: смещённый край, как на приводке — приём, а не слой',
  '3px 3px 0 rgba(123, 123, 255': 'тот же оттиск под курсором',
  '0 0 0 4px var(--bg-warning)': 'кольцо-индикатор у текущего шага маршрута, а не тень',
  'inset 0 3px 0 0 var(--accent)': 'метка места вставки при перетаскивании',
  'inset 0 -3px 0 0 var(--accent)': 'она же снизу',
  none: 'снятие тени',
};

function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

function shadows(): { file: string; line: number; value: string }[] {
  const out: { file: string; line: number; value: string }[] = [];
  for (const rel of CSS) {
    const file = join(process.cwd(), rel);
    if (!existsSync(file)) continue;
    withoutCssComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      if (/^\s*--/.test(line)) return; // объявление самого токена
      const m = /box-shadow:\s*([^;{}]+)/.exec(line);
      if (m) out.push({ file: rel, line: i + 1, value: m[1].trim() });
    });
  }
  return out;
}

describe('тени раздела описаны токенами', () => {
  it('объявления теней есть — иначе сторож проверяет пустоту', () => {
    expect(shadows().length).toBeGreaterThan(3);
  });

  it('каждая тень — либо токен, либо названное исключение', () => {
    const bad = shadows()
      .filter((s) => !s.value.includes('var(--shadow')
        && !s.value.includes('var(--focus-ring')
        && !Object.keys(ALLOWED).some((k) => s.value.includes(k)))
      .map((s) => `${s.file}:${s.line} — ${s.value}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('кольцо фокуса нигде не выписано руками', () => {
    const bad = shadows()
      .filter((s) => /0 0 0 2px var\(--card\)/.test(s.value))
      .map((s) => `${s.file}:${s.line} — кольцо фокуса копией → var(--focus-ring)`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('исключения не протухли: каждое ещё встречается в CSS', () => {
    const all = shadows().map((s) => s.value).join('\n');
    const stale = Object.keys(ALLOWED).filter((k) => k !== 'none' && !all.includes(k));
    expect(stale, `исключение без носителя: ${stale.join(', ')}`).toEqual([]);
  });
});
