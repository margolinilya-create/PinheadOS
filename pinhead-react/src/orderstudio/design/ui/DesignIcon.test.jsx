import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DesignIcon } from './DesignIcon';
import { DESIGN_ICONS, DESIGN_ICON_NAMES } from './designIcons';

/** Набор плана (решение 9) — его ждёт панель задачи 6б */
const PLAN_SET = ['upload', 'redo', 'flipH', 'flipV', 'rotateCw', 'rotateCcw', 'copy', 'layers',
  'zoomIn', 'zoomOut', 'fit', 'lock', 'unlock', 'eyeOff'];

describe('DesignIcon', () => {
  it('svg 24×24 с заданным размером, цвет — currentColor', () => {
    const { container } = render(<DesignIcon name="zoomIn" size={22} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
  });

  it('по умолчанию декоративная; с title — доступная картинка', () => {
    const { container, rerender, getByTitle } = render(<DesignIcon name="upload" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).not.toHaveAttribute('role');
    rerender(<DesignIcon name="warning" title="Выходит за зону" />);
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
    expect(getByTitle('Выходит за зону')).toBeInTheDocument();
  });

  it('неизвестное имя не роняет рендер', () => {
    const { container } = render(<DesignIcon name="нет-такой" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('в наборе все иконки плана; каждая рисуется и состоит из path/circle/rect', () => {
    expect(PLAN_SET.filter((n) => !DESIGN_ICON_NAMES.includes(n))).toEqual([]);
    const allowed = new Set(['path', 'circle', 'rect']);
    for (const name of DESIGN_ICON_NAMES) {
      expect(DESIGN_ICONS[name].length).toBeGreaterThan(0);
      for (const shape of DESIGN_ICONS[name]) expect(allowed.has(shape.t)).toBe(true);
      const { container, unmount } = render(<DesignIcon name={name} />);
      expect(container.querySelectorAll('svg > *').length).toBe(DESIGN_ICONS[name].length);
      unmount();
    }
  });
});
