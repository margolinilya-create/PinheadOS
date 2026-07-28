import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState, ErrorState } from './States';

describe('EmptyState', () => {
  it('показывает заголовок, пояснение и действие', () => {
    render(
      <EmptyState title="Заказов нет" text="Создайте первый заказ." action={<button type="button">Новый заказ</button>} />,
    );
    expect(screen.getByText('Заказов нет')).toBeInTheDocument();
    expect(screen.getByText('Создайте первый заказ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Новый заказ' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('это alert с текстом по умолчанию', () => {
    render(<ErrorState />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить данные');
  });

  it('кнопка «Повторить» появляется только с onRetry и вызывает его', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState />);
    expect(screen.queryByRole('button', { name: /Повторить/ })).toBeNull();

    rerender(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
