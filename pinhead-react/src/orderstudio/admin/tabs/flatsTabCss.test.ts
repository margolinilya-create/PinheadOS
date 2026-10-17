// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource, SRC_DIR } from '../../../testutil/sourceFiles';

/**
 * Сторож стилей вкладки «Флэты и зоны» (веха 5а, задача 4, раунд 1 ревью):
 * область `aria-live` сида скрыта только визуально. Регион с `display: none`
 * выпадает из дерева доступности, и первое объявление («Готовлю загрузку…»)
 * диктор пропускает.
 */
const CSS = readSource(join(SRC_DIR, 'orderstudio', 'admin', 'tabs', 'FlatsTab.module.css'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('FlatsTab.module.css', () => {
  it('область диктора — sr-only, а не display: none', () => {
    const srOnly = CSS.match(/\.srOnly\s*\{[^}]*\}/)?.[0] ?? '';
    expect(srOnly).toMatch(/position:\s*absolute/);
    expect(srOnly).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(CSS).not.toMatch(/display:\s*none/);
  });

  it('прокручиваемая область таблицы показывает кольцо фокуса', () => {
    expect(CSS).toMatch(/\.scroll:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });
});
