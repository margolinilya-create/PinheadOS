import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FlatIcon } from './FlatIcon';
import { FLAT_ICONS, FLAT_ICON_NAMES } from './flatIcons';
import { DESIGN_ICONS } from '../../design/ui/designIcons';

/** Иконки, которыми пользуется редактор флэта (кнопки зон, точек, видов, замечания) */
const USED = ['plus', 'trash', 'arrowUp', 'arrowDown', 'ruler', 'close', 'warning'];

describe('FlatIcon — свой набор редактора флэта (задача 7)', () => {
  it('svg 24×24, цвет — currentColor, по умолчанию декоративная; с title — картинка с именем', () => {
    const { container, rerender, getByTitle } = render(<FlatIcon name="trash" size={22} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    rerender(<FlatIcon name="warning" title="Стоит проверить" />);
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
    expect(getByTitle('Стоит проверить')).toBeInTheDocument();
  });

  it('неизвестное имя не роняет рендер', () => {
    const { container } = render(<FlatIcon name="нет-такой" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('в наборе все иконки редактора; каждая рисуется', () => {
    expect(USED.filter((n) => !FLAT_ICON_NAMES.includes(n))).toEqual([]);
    for (const name of FLAT_ICON_NAMES) {
      const { container, unmount } = render(<FlatIcon name={name} />);
      expect(container.querySelectorAll('svg > *').length).toBe(FLAT_ICONS[name].length);
      unmount();
    }
  });

  it('общие с холстом имена рисуются так же, как на холсте', () => {
    const shared = FLAT_ICON_NAMES.filter((n) => n in DESIGN_ICONS);
    expect(shared).toEqual(expect.arrayContaining(['close', 'warning']));
    for (const name of shared) expect(FLAT_ICONS[name]).toEqual(DESIGN_ICONS[name]);
  });
});
