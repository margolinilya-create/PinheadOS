import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PurchaseSizeTable } from './PurchaseSizeTable';

/**
 * РАЗМЕРЫ ВНУТРИ ЗАКУПКИ ГОТОВОГО ИЗДЕЛИЯ (правка заказчика 20.09, п. 2).
 *
 * «Ранее переданное требование реализовано не полностью. В форме появился
 * выбор позиции заказа с названием, цветом и общим количеством, но размерной
 * разбивки на скриншоте нет».
 */
describe('таблица «Размер / Количество к заказу / Фактическое количество»', () => {
  const PLANNED = [{ color: '—', sizes: { S: 2, M: 3, L: 3 } }];

  it('потребность из заказа показана и не правится руками', () => {
    render(<PurchaseSizeTable plannedGrid={PLANNED} orderedGrid={null} onChange={vi.fn()} />);

    expect(screen.getByText('Количество к заказу')).toBeInTheDocument();
    // Итог по колонке потребности — сумма размеров
    expect(screen.getByText('8')).toBeInTheDocument();
    // Ввод ровно один на строку — фактическое количество
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });

  it('введённый факт уезжает СЕТКОЙ того же формата, что потребность', () => {
    const onChange = vi.fn();
    render(<PurchaseSizeTable plannedGrid={PLANNED} orderedGrid={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('M, Фактическое количество'), {
      target: { value: '5' },
    });

    expect(onChange).toHaveBeenCalledWith([{ color: '—', sizes: { M: 5 } }]);
  });

  it('уже заказанное показывается в полях, а не теряется при открытии', () => {
    render(
      <PurchaseSizeTable
        plannedGrid={PLANNED}
        orderedGrid={[{ color: '—', sizes: { S: 2, M: 4 } }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('S, Фактическое количество')).toHaveValue(2);
    expect(screen.getByLabelText('M, Фактическое количество')).toHaveValue(4);
    expect(screen.getByLabelText('L, Фактическое количество')).toHaveValue(null);
  });

  it('правка одной строки НЕ стирает соседние', () => {
    const onChange = vi.fn();
    render(
      <PurchaseSizeTable
        plannedGrid={PLANNED}
        orderedGrid={[{ color: '—', sizes: { S: 2 } }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('L, Фактическое количество'), {
      target: { value: '3' },
    });
    expect(onChange).toHaveBeenCalledWith([{ color: '—', sizes: { S: 2, L: 3 } }]);
  });

  /**
   * «Применить ко всем готовым изделиям. Для изделий без размеров показывать
   * только общее количество» — пустая таблица на ручку или ежедневник была бы
   * шумом, а не сведением.
   */
  it('у изделия без размеров таблицы нет вовсе', () => {
    const { container } = render(
      <PurchaseSizeTable plannedGrid={null} orderedGrid={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('цвет различает строки: один размер двух цветов — две строки', () => {
    render(
      <PurchaseSizeTable
        plannedGrid={[
          { color: 'чёрный', sizes: { M: 5 } },
          { color: 'белый', sizes: { M: 7 } },
        ]}
        orderedGrid={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('M · чёрный, Фактическое количество')).toBeInTheDocument();
    expect(screen.getByLabelText('M · белый, Фактическое количество')).toBeInTheDocument();
  });
});
