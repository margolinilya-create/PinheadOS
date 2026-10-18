// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../testutil/sourceFiles';

/**
 * Сторож стилей оболочки «ТЗ».
 *  1. `.orderMain` обязан обнулять `--header-h`: липкие панели визарда и каталога
 *     считают отступ от шапки в 52 px, а в оболочке шапка не липкая — без нуля
 *     под ней остаётся щель.
 *  2. `--preview-bar-h` (превью роли убрано) не встречается ни в одном CSS.
 *  3. Палитра `.shell` в `OrderLayout.module.css` — снимок ERP; расхождение
 *     с `erp/erp.module.css` ловится здесь, ERP при этом только читается.
 */
const ORDER_CSS = readSource(join(SRC_DIR, 'orderstudio', 'layout', 'OrderLayout.module.css'));
const ERP_CSS = readSource(join(SRC_DIR, 'erp', 'erp.module.css'));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Тело первого блока с данным селектором */
function block(css: string, selector: string): string {
  const clean = stripComments(css);
  const start = clean.indexOf(`${selector} {`);
  if (start < 0) return '';
  const open = clean.indexOf('{', start);
  return clean.slice(open + 1, clean.indexOf('}', open));
}

/** Пользовательские свойства блока: имя -> значение без лишних пробелов */
function customProps(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    props[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return props;
}

describe('OrderLayout.module.css', () => {
  it('.orderMain обнуляет --header-h', () => {
    expect(block(ORDER_CSS, '.orderMain')).toMatch(/--header-h:\s*0px;/);
  });

  it('--preview-bar-h не встречается ни в одном CSS', () => {
    const offenders = sourceFiles(SRC_DIR, { ext: /\.css$/ })
      .filter((p) => readSource(p).includes('--preview-bar-h'));
    expect(offenders).toEqual([]);
  });

  for (const [name, selector] of [
    ['светлая', ':global(html) .shell'],
    ['тёмная', ":global(html[data-theme='dark']) .shell"],
  ] as const) {
    it(`палитра ${name} совпадает с ERP`, () => {
      const erp = customProps(block(ERP_CSS, selector));
      const mine = customProps(block(ORDER_CSS, selector));
      expect(Object.keys(erp).length).toBeGreaterThan(30);
      expect(
        mine,
        'Палитра оболочки ERP изменилась — обновите снимок в OrderLayout.module.css',
      ).toEqual(erp);
    });
  }

  /** Тело блоков `@media (<условие>) { … }` подряд — грубо, но без вложенных @media в этом файле */
  function mediaBody(css: string, condition: string): string {
    const clean = stripComments(css);
    let out = '';
    let at = clean.indexOf(condition);
    while (at >= 0) {
      const open = clean.indexOf('{', at);
      let depth = 1;
      let i = open + 1;
      for (; i < clean.length && depth > 0; i += 1) {
        if (clean[i] === '{') depth += 1;
        else if (clean[i] === '}') depth -= 1;
      }
      out += clean.slice(open + 1, i - 1);
      at = clean.indexOf(condition, i);
    }
    return out;
  }

  /**
   * Доступ к разделу читает входной чанк (`config/shellChoice.ts`, веха 8, К1)
   * из `salesAccess.ts`, а не из `orderNav.ts`: модуль попадает в чанк целиком,
   * и меню с гейтами раздела уехали бы во вход (замер задачи 5: +3428 Б).
   * В `salesAccess.ts` нет рантайм-импортов (`import type` стирается при сборке)
   */
  const runtimeImports = (src: string) => [
    ...[...src.matchAll(/^\s*import\s+(?!type\b)[^;]*;?/gm)].map((m) => m[0].trim()),
    ...[...src.matchAll(/^\s*export\s+(?!type\b)[^;]*\bfrom\s[^;]*;?/gm)].map((m) => m[0].trim()),
    ...(/\bimport\s*\(/.test(src) ? ['import()'] : []),
  ];

  it('salesAccess.ts без рантайм-импортов — его читает входной чанк', () => {
    const access = readSource(join(SRC_DIR, 'orderstudio', 'layout', 'salesAccess.ts'));
    expect(runtimeImports(access)).toEqual([]);
    // Сторож видит импорт (мутация)
    expect(runtimeImports("import { x } from './orderNav';")).toHaveLength(1);
    expect(runtimeImports("import type { x } from './orderNav';")).toEqual([]);
  });

  it('выбор оболочки берёт доступ из salesAccess, а не из orderNav', () => {
    const shell = readSource(join(SRC_DIR, 'config', 'shellChoice.ts'));
    expect(shell).toMatch(/from '\.\.\/orderstudio\/layout\/salesAccess'/);
    expect(shell).not.toMatch(/layout\/orderNav/);
  });

  // Веха 8, задача 5: шапка и сайдбар на 375 px
  it('тень у сайдбара — только у открытого (.sidebarOpen), у закрытого её нет', () => {
    const overlay = mediaBody(ORDER_CSS, '@media (max-width: 1024px), (pointer: coarse)');
    expect(block(overlay, '.sidebar')).not.toMatch(/box-shadow/);
    expect(block(ORDER_CSS, '.sidebar')).not.toMatch(/box-shadow/);
    expect(overlay).toMatch(/\.sidebarOpen\s*\{[^}]*box-shadow:\s*var\(--shadow-modal\)/);
  });

  it('на ≤ 480 px заголовок раздела скрыт, «Производство» — иконкой 44 px', () => {
    const narrow = mediaBody(ORDER_CSS, '@media (max-width: 480px)');
    expect(block(narrow, '.sectionTitle')).toMatch(/display:\s*none/);
    expect(block(narrow, '.prodBtn')).toMatch(/width:\s*44px/);
    expect(block(narrow, '.prodBtn')).toMatch(/height:\s*44px/);
    // Подпись не пропадает для читалки: клип, а не display: none
    expect(block(narrow, '.prodLabel')).toMatch(/clip:/);
    expect(block(narrow, '.prodLabel')).not.toMatch(/display:\s*none/);
  });
});
