import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState, EmptyResult, LoadFailed, UpdateAvailable, ScreenCrashed } from './ErpStates';

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

/**
 * Устаревшая вкладка после выкатки: чанк формы «Новый заказ» исчез под
 * прежним именем. До 27.09 граница ЭКРАНА рисовала это как «Не удалось
 * загрузить экран (Failed to fetch dynamically imported module: …)» с кнопкой
 * «Повторить», которая при отказе `React.lazy` бесполезна. Нужны свои слова
 * и своя кнопка — перезагрузка, и только по нажатию.
 */
describe('UpdateAvailable', () => {
  it('говорит про обновление и перезагружает только по кнопке', () => {
    const onReload = vi.fn();
    render(<UpdateAvailable onReload={onReload} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Вышло обновление приложения');
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Обновить/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenCrashed', () => {
  it('пропавший чанк — это «вышло обновление», а не сырой текст браузера', () => {
    const error = new Error('Failed to fetch dynamically imported module: '
      + 'https://pinhead-os.vercel.app/assets/CreateOrderModal-CtVzS8xJ.js');
    render(<ScreenCrashed error={error} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Вышло обновление приложения');
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(screen.queryByText(/Проверьте связь/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Повторить/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Обновить/ })).toBeInTheDocument();
  });

  /**
   * ОТРИЦАТЕЛЬНАЯ ПОЛОВИНА: настоящая ошибка кода должна остаться видимой
   * текстом и со сбросом границы — иначе «обновите страницу» станет ответом
   * на всё, а набранное в форме пропадёт зря.
   */
  it('обычное падение экрана показывает текст ошибки и «Повторить»', () => {
    const onRetry = vi.fn();
    render(<ScreenCrashed error={new TypeError('x is not a function')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить экран (x is not a function)');
    expect(screen.queryByText(/Вышло обновление/)).toBeNull();
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
