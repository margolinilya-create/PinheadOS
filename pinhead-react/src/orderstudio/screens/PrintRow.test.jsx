import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { newSalesPrint } from '../model/factory';
import PrintRow from './PrintRow';

const base = { index: 0, itemSizes: [], zones: ['Грудь'], unitPrice: null, qty: 0 };

function setup(over = {}) {
  const props = {
    ...base,
    print: newSalesPrint({ zone: 'Грудь', width_mm: 120, height_mm: 80, offset_mm: 75, offset_from: 'neck_seam', offset_dir: 'down' }),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<PrintRow {...props} />);
  return props;
}

describe('PrintRow — нанесение на холсте (веха 5а)', () => {
  it('placed: зона и мм только для чтения, отступ с холста текстом, «Изменить на холсте»', () => {
    const onOpenDesign = vi.fn();
    setup({ placed: true, onOpenDesign });
    expect(screen.getByLabelText('Зона')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Ширина, мм')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Высота, мм')).toHaveAttribute('readonly');
    expect(screen.getByText(/отступ 75 мм от шва горловины/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить на холсте' }));
    expect(onOpenDesign).toHaveBeenCalledTimes(1);
  });

  it('не на холсте: поля правятся, ссылка «Поставить на изделие →»', () => {
    const props = setup({ onOpenDesign: vi.fn() });
    expect(screen.getByLabelText('Ширина, мм')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Ширина, мм'), { target: { value: '90' } });
    expect(props.onChange).toHaveBeenCalledWith({ width_mm: 90 });
    expect(screen.getByRole('button', { name: 'Поставить на изделие →' })).toBeInTheDocument();
  });

  it('без onOpenDesign ссылки нет (как до вехи 5а)', () => {
    setup();
    expect(screen.queryByRole('button', { name: /холсте|на изделие/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('холст только для просмотра (≤ 760): на холсте — «Открыть на холсте», без холста — ссылки нет', () => {
    const onOpenDesign = vi.fn();
    setup({ placed: true, onOpenDesign, designViewOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть на холсте' }));
    expect(onOpenDesign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Изменить на холсте|Поставить на изделие/ })).toBeNull();
  });

  it('холст только для просмотра: у строки без холста «Поставить на изделие →» нет — действия не будет', () => {
    setup({ onOpenDesign: vi.fn(), designViewOnly: true });
    expect(screen.queryByRole('button', { name: /холсте|на изделие/ })).toBeNull();
  });

  it('embedded: без техники, зоны, мм и «Удалить» — они в инспекторе', () => {
    setup({ placed: true, embedded: true });
    expect(screen.queryByLabelText('Техника')).toBeNull();
    expect(screen.queryByLabelText('Зона')).toBeNull();
    expect(screen.queryByLabelText('Ширина, мм')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.getByLabelText('Pantone (через запятую)')).toBeInTheDocument();
  });
});
