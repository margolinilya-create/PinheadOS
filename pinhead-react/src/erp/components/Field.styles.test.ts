import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ОДИН КОНТРОЛ ВВОДА НА РАЗДЕЛ (обход 04.09).
 *
 * Примитив `Field` и класс `.input` — один и тот же элемент интерфейса,
 * заведённый дважды, и они разошлись по трём объявлениям сразу: рамка
 * (`--border-mid` 1,47:1 против `--border-control`), высота (36 против 40)
 * и скругление. Решение владельца 03.09 о границах, проходящих AA (1.4.11),
 * доехало до `.input` и не доехало до примитива.
 *
 * Сторож читает НАСТОЯЩИЙ CSS: разойтись обратно можно одной правкой,
 * и ни один функциональный тест этого не увидит — разметка та же, поведение
 * то же, отличается только вид.
 *
 * ФАЙЛ `.ts`, А НЕ `.jsx`: в `.jsx` конфиг ESLint даёт `no-undef` на `process`,
 * а путь к CSS иначе не собрать (`import.meta.url` в Vitest не файловая схема).
 * Тот же приём, что у `DevAnnotations.sources.test.ts`.
 */
function declarations(file: string, selector: string): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const m = css.match(new RegExp(`\\n\\.${selector}[^{]*\\{([^}]*)\\}`));
  expect(m, `«${selector}» не найден в ${file}`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const decl of (m as RegExpMatchArray)[1].split(';')) {
    const [prop, ...rest] = decl.split(':');
    if (!prop.trim() || rest.length === 0) continue;
    out[prop.trim()] = rest.join(':').trim();
  }
  return out;
}

describe('поле ввода — одно на раздел', () => {
  it('примитив и класс совпадают рамкой, высотой и скруглением', () => {
    const field = declarations('src/erp/components/Field.module.css', 'control');
    const input = declarations('src/erp/erp.module.css', 'input, .select');
    for (const prop of ['border', 'border-radius', 'min-height']) {
      expect(field[prop], `«${prop}» разошёлся`).toBe(input[prop]);
    }
  });

  /** ≥44px на тач-экранах цехов — у обоих, иначе правило половинчато */
  it('оба поднимаются до 44px на тач-экране', () => {
    const field = readFileSync(resolve(process.cwd(), 'src/erp/components/Field.module.css'), 'utf8');
    const erp = readFileSync(resolve(process.cwd(), 'src/erp/erp.module.css'), 'utf8');
    expect(field).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.control[^}]*min-height:\s*44px/);
    expect(erp).toMatch(/min-height:\s*44px/);
  });
});
