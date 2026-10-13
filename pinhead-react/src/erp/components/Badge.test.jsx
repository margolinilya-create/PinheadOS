import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

// CSS-модули в Vitest не обрабатываются (класс = undefined) — проверяем контент/поведение, не классы.
describe('Badge', () => {
  it('рендерит children', () => {
    render(<Badge variant="ready">Готово</Badge>);
    expect(screen.getByText('Готово')).toBeInTheDocument();
  });

  it('неизвестный вариант не роняет рендер (фолбэк neutral)', () => {
    render(<Badge variant="whatever">X</Badge>);
    expect(screen.getByText('X')).toBeInTheDocument();
  });

  it('пробрасывает лишние пропы (title)', () => {
    render(<Badge variant="info" title="подсказка">Y</Badge>);
    expect(screen.getByText('Y')).toHaveAttribute('title', 'подсказка');
  });
});
