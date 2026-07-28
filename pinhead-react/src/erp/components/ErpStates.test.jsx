import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState, EmptyResult, LoadFailed } from './ErpStates';

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

describe('LoadFailed', () => {
  it('это alert с текстом по умолчанию', () => {
    render(<LoadFailed />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить данные');
  });

  it('кнопка «Повторить» появляется только с onRetry и вызывает его', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<LoadFailed />);
    expect(screen.queryByRole('button', { name: /Повторить/ })).toBeNull();

    rerender(<LoadFailed onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyResult', () => {
  it('показывает текст запроса, когда искали строкой', () => {
    render(<EmptyResult query="худи" />);
    expect(screen.getByText(/Ничего не найдено по запросу «худи»/)).toBeInTheDocument();
  });

  it('без запроса говорит про фильтры', () => {
    render(<EmptyResult />);
    expect(screen.getByText('Под фильтры ничего не попало.')).toBeInTheDocument();
  });

  it('«Сбросить» появляется только с onReset', () => {
    const onReset = vi.fn();
    const { rerender } = render(<EmptyResult query="х" />);
    expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();

    rerender(<EmptyResult query="х" onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
