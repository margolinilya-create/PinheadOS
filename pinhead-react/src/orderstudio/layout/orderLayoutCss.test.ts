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
});
