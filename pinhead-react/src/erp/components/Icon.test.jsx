import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon';
import { ICONS, ICON_NAMES } from './icons';

describe('Icon', () => {
  it('рендерит svg 24×24 с заданным размером', () => {
    const { container } = render(<Icon name="orders" size={22} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg).toHaveAttribute('height', '22');
  });

  it('по умолчанию декоративная: aria-hidden, без role', () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('с title становится доступной картинкой', () => {
    const { container, getByTitle } = render(<Icon name="clock" title="Просрочка" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).not.toHaveAttribute('aria-hidden');
    expect(getByTitle('Просрочка')).toBeInTheDocument();
  });

  it('неизвестное имя не роняет рендер', () => {
    const { container } = render(<Icon name="нет-такой-иконки" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('наследует цвет через currentColor', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  });

  it('все иконки набора рендерятся и состоят из известных фигур', () => {
    const allowed = new Set(['path', 'circle', 'rect']);
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      expect(Array.isArray(ICONS[name])).toBe(true);
      expect(ICONS[name].length).toBeGreaterThan(0);
      for (const shape of ICONS[name]) expect(allowed.has(shape.t)).toBe(true);

      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
      unmount();
    }
  });
});
