import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ТАБ-ПАТТЕРН СОБИРАЕТСЯ ТОЛЬКО ПРИМИТИВОМ.
 *
 * Правило проекта: `role="tab"` ставится ТОЛЬКО вместе с `tablist`,
 * `aria-controls`, `role="tabpanel"`, roving tabindex и стрелками —
 * половина паттерна хуже обычных кнопок с `aria-pressed`.
 *
 * Сторож нужен потому, что забыть можно ровно половину, а ВЫГЛЯДЕТЬ она будет
 * так же: до 05.09 паттерн писали от руки в шести местах, и у `PlanScreen`
 * кнопки уже стояли без `id`, а панель — без `aria-labelledby`. Пять мест
 * из шести связь ставили, шестое молча нет. Ни один функциональный тест
 * этого не видел: разметка та же, поведение то же.
 *
 * Проверка текстовая и по исходникам — как `stylesResolve` и `primitives`:
 * свойство «реализация одна» тестом поведения не выражается.
 */

const ERP = resolve(__dirname, '..');

/** Комментарии снимаем ДО поиска — правило проекта */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|tsx?)$/.test(name) || /\.test\./.test(name)) continue;
      out.push({ path: full.slice(ERP.length + 1), src: withoutComments(readFileSync(full, 'utf8')) });
    }
  };
  walk(ERP);
  return out;
}

const PRIMITIVE = join('components', 'Tabs.jsx');

/**
 * ИСКЛЮЧЕНИЯ — ПОИМЁННО И С ПРИЧИНОЙ (правило проекта). Единственное:
 * `utils/tabs` — сама клавиатурная половина паттерна, она ИЩЕТ `[role="tab"]`
 * в уже отрисованном ряду, а не объявляет роль. Её и зовёт примитив.
 */
const KEYBOARD_IMPL = join('utils', 'tabs.js');

describe('вкладки раздела', () => {
  it('`role="tab"` объявляется только примитивом', () => {
    const offenders = sources()
      .filter((f) => /role="tab"/.test(f.src) && f.path !== KEYBOARD_IMPL)
      .map((f) => f.path);
    expect(offenders).toEqual([PRIMITIVE]);
  });

  it('`role="tabpanel"` — тоже: иначе половина связи снова разъедется', () => {
    const offenders = sources()
      .filter((f) => /role="tabpanel"/.test(f.src))
      .map((f) => f.path);
    expect(offenders).toEqual([PRIMITIVE]);
  });

  /**
   * `onTabListKeyDown` — стрелки внутри ряда. Вне примитива её вызов означает,
   * что кто-то строит ряд вкладок сам: половина паттерна начинается именно так.
   */
  it('обработчик стрелок вызывается только примитивом', () => {
    const offenders = sources()
      .filter((f) => /onTabListKeyDown/.test(f.src) && f.path !== KEYBOARD_IMPL)
      .map((f) => f.path);
    expect(offenders).toEqual([PRIMITIVE]);
  });

  /**
   * ОБЕ ПОЛОВИНЫ СВЯЗИ СОБИРАЮТСЯ ИЗ ОДНОГО `idPrefix`. Это и есть свойство,
   * ради которого примитив заведён: вкладка ссылается на панель, панель —
   * на вкладку, и разнести их по разным файлам больше нельзя.
   */
  it('примитив ставит обе стороны связи', () => {
    const src = readFileSync(join(ERP, 'components', 'Tabs.jsx'), 'utf8');
    expect(src).toMatch(/aria-controls=\{`\$\{idPrefix\}-tabpanel`\}/);
    expect(src).toMatch(/id=\{`\$\{idPrefix\}-tab-\$\{t\.id\}`\}/);
    expect(src).toMatch(/aria-labelledby=\{active \? `\$\{idPrefix\}-tab-\$\{active\}` : undefined\}/);
    expect(src).toMatch(/id=\{`\$\{idPrefix\}-tabpanel`\}/);
    // roving tabindex: невыбранные вкладки вне обхода Tab
    expect(src).toMatch(/tabIndex=\{active === t\.id \? 0 : -1\}/);
  });
});
