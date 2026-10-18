import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { newSalesOrder } from '../model/factory';
import { useSalesStore } from '../store/useSalesStore';
import ClientTab from './ClientTab';

/**
 * Вкладка «Клиент» — «Комментарий для цехов» (веха 8, К5). Поле есть, только
 * когда сервер знает `notes` (миграция K): иначе текст молча пропал бы после F5.
 */
function setup({ notes = '', readOnly = false } = {}) {
  const onChange = vi.fn();
  render(<ClientTab order={newSalesOrder({ notes })} readOnly={readOnly} onChange={onChange} />);
  return { onChange };
}

const field = () => screen.queryByRole('textbox', { name: 'Комментарий для цехов' });

beforeEach(() => useSalesStore.setState({ serverHasNotes: false }));

describe('ClientTab — комментарий для цехов', () => {
  it('сервер старше K (нет notes в ответе) — поля нет', () => {
    setup({ notes: 'было' });
    expect(field()).toBeNull();
  });

  it('сервер знает поле — есть, с подсказкой и счётчиком в описании', () => {
    useSalesStore.setState({ serverHasNotes: true });
    setup({ notes: 'Упаковать по 10' });
    const f = field();
    expect(f).toHaveValue('Упаковать по 10');
    expect(f).toHaveAttribute('maxLength', '2000');
    expect(f).toHaveAccessibleDescription(/Видят все цеха/);
    expect(f).toHaveAccessibleDescription(/15 из 2000/);
  });

  it('правка уходит в заказ полем notes', () => {
    useSalesStore.setState({ serverHasNotes: true });
    const { onChange } = setup();
    fireEvent.change(field(), { target: { value: 'Без бирок' } });
    expect(onChange).toHaveBeenCalledWith({ notes: 'Без бирок' });
  });

  it('счётчик — не живой регион; от 1900 знаков — живая строка «Осталось N знаков»', () => {
    useSalesStore.setState({ serverHasNotes: true });
    setup({ notes: 'а'.repeat(1899) });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByText('1899 из 2000').closest('[aria-live],[role="status"]')).toBeNull();
  });

  it('1998 знаков — «Осталось 2 знака»', () => {
    useSalesStore.setState({ serverHasNotes: true });
    setup({ notes: 'а'.repeat(1998) });
    expect(screen.getByRole('status')).toHaveTextContent('Осталось 2 знака');
  });

  it('не черновик — поле только для чтения (fieldset закрыт)', () => {
    useSalesStore.setState({ serverHasNotes: true });
    setup({ notes: 'текст', readOnly: true });
    expect(field()).toBeDisabled();
  });
});
