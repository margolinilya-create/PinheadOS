import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ДЛИТЕЛЬНОСТЬ И КРИВАЯ — ТОКЕНЫ, А НЕ ЧИСЛА ПО МЕСТУ.
 *
 * До 12.09 в CSS раздела жили семь длительностей — 120 · 130 · 140 · 150 ·
 * 160 · 180 · 200 мс — и две кривые (`ease` и `ease-out`) вперемешку.
 * Разницу между 130 и 140 никто не выбирал: она накопилась, как накопились
 * десять кеглей и девять ширин полей. На глаз такие различия не видны
 * поодиночке, а вместе дают интерфейс, который «дёргается по-разному
 * в разных углах».
 *
 * Три ступени (`--dur-fast` под курсором, `--dur-base` на появление,
 * `--dur-slow` на выезд панели) и одна кривая описывают всё, что в разделе
 * действительно происходит. Сторож держит их: иначе восьмое число появится
 * в первой же правке — ровно так возвращались 90 фолбэков `var(--x, Y)`
 * и 26 нарушений порога мелкого текста.
 *
 * ВНЕ ПРОВЕРКИ — `@keyframes` и `animation`: длительность крутящегося
 * спиннера (640ms) и мерцания скелетона отвечает на другой вопрос,
 * чем «как быстро элемент отзывается на курсор».
 */

const ERP_CSS = [
  'src/erp/erp.module.css',
  'src/erp/screens.module.css',
  'src/erp/components/Button.module.css',
  'src/erp/components/Field.module.css',
  'src/erp/components/States.module.css',
];

/** Комментарии снимаются ДО поиска: объяснение «почему тут больше нет 130ms»
 *  содержит те же числа, и сторож упал бы на собственном тексте. */
function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

function transitions(): { file: string; line: number; value: string }[] {
  const out: { file: string; line: number; value: string }[] = [];
  for (const rel of ERP_CSS) {
    const file = join(process.cwd(), rel);
    if (!existsSync(file)) continue;
    withoutCssComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      const m = /transition(?:-duration|-timing-function)?:\s*([^;{}]+)/.exec(line);
      if (m) out.push({ file: rel, line: i + 1, value: m[1] });
    });
  }
  return out;
}

describe('движение раздела описано токенами', () => {
  it('объявления перехода есть — иначе сторож проверяет пустоту', () => {
    expect(transitions().length).toBeGreaterThan(5);
  });

  it('ни одной длительности числом', () => {
    const bad = transitions()
      .filter((t) => /\b\d+m?s\b/.test(t.value))
      .map((t) => `${t.file}:${t.line} — ${t.value.trim()} → var(--dur-*)`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('ни одной кривой голым ключевым словом', () => {
    const bad = transitions()
      .filter((t) => /(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-)])/.test(t.value))
      .map((t) => `${t.file}:${t.line} — ${t.value.trim()} → var(--ease-out)`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('каждый var(--dur-*) и var(--ease-*) ссылается на объявленный токен', () => {
    const index = withoutCssComments(readFileSync(join(process.cwd(), 'src/index.css'), 'utf8'));
    const declared = new Set([...index.matchAll(/(--(?:dur|ease)-[\w-]+):/g)].map((m) => m[1]));
    expect(declared.size, 'токены движения не объявлены вовсе').toBeGreaterThan(3);

    const bad: string[] = [];
    for (const t of transitions()) {
      for (const m of t.value.matchAll(/var\((--(?:dur|ease)-[\w-]+)\)/g)) {
        if (!declared.has(m[1])) bad.push(`${t.file}:${t.line} — ${m[1]} не объявлен в index.css`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
