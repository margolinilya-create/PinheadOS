import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('по умолчанию type=button — не сабмитит форму случайно', () => {
    render(<Button>Готово</Button>);
    expect(screen.getByRole('button', { name: 'Готово' })).toHaveAttribute('type', 'button');
  });

  it('вызывает onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Взять в работу</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading блокирует кнопку и прячет иконку', () => {
    const { container } = render(<Button loading icon="check">Сохранить</Button>);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    // при загрузке вместо иконки — спиннер, svg не рендерится
    expect(container.querySelector('svg')).toBeNull();
  });

  it('loading не пропускает клик', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Сохранить</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled блокирует кнопку', () => {
    render(<Button disabled>Готово</Button>);
    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
  });

  it('icon рендерит иконку рядом с подписью', () => {
    const { container } = render(<Button icon="truck">Отгрузить</Button>);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отгрузить' })).toBeInTheDocument();
  });

  it('iconOnly берёт имя из aria-label и не рендерит подпись', () => {
    render(<Button iconOnly icon="x" aria-label="Закрыть">Закрыть</Button>);
    const btn = screen.getByRole('button', { name: 'Закрыть' });
    expect(btn).toHaveTextContent('');
  });

  it('пробрасывает произвольные атрибуты на кнопку', () => {
    render(<Button title="Подсказка" data-testid="b">Ок</Button>);
    expect(screen.getByTestId('b')).toHaveAttribute('title', 'Подсказка');
  });
});
