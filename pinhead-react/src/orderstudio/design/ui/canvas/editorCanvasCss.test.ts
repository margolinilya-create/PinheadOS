// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource, SRC_DIR } from '../../../../testutil/sourceFiles';

/**
 * Сторож стилей холста (веха 5а, задача 6а; проверка скиллами — доступность и тач):
 * - пересказ `aria-live` и подсказка клавиш скрыты только визуально (`display: none`
 *   выбросил бы их из дерева доступности — диктор промолчит);
 * - у области холста видимое кольцо фокуса (`--focus-ring`);
 * - жесты пальцем достаются konva (`touch-action: none`);
 * - кнопки масштаба — тач-цель по токену высоты (44 px на `pointer: coarse`).
 */
const CSS = readSource(join(SRC_DIR, 'orderstudio', 'design', 'ui', 'canvas', 'EditorCanvas.module.css'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rule = (selector: string) => CSS.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';

describe('EditorCanvas.module.css', () => {
  it('диктор и подсказка — sr-only, а не display: none', () => {
    expect(rule('.srOnly')).toMatch(/position:\s*absolute/);
    expect(rule('.srOnly')).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(CSS).not.toMatch(/display:\s*none/);
  });

  it('кольцо фокуса у области холста и у кнопок масштаба', () => {
    expect(CSS).toMatch(/\.canvas:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
    expect(CSS).toMatch(/\.zoomBtn:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });

  it('жесты пальцем — konva: touch-action: none у области холста', () => {
    expect(rule('.canvas')).toMatch(/touch-action:\s*none/);
  });

  it('кнопки масштаба не ниже токена высоты контрола (44 px пальцем)', () => {
    expect(rule('.zoomBtn')).toMatch(/min-width:\s*var\(--control-h-md\)/);
    expect(rule('.zoomBtn')).toMatch(/min-height:\s*var\(--control-h-md\)/);
  });
});
