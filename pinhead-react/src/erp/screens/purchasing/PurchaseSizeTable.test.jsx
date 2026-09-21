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

  /**
   * БАГ ВВОДА ФАКТИЧЕСКОГО КОЛИЧЕСТВА (правка 21.09, п. 8): «при вводе обычного
   * числа система начинает самопроизвольно подставлять и накапливать большие
   * значения… вместо введённого количества появляются значения вида 336842,
   * а общий итог пересчитывается в 673684».
   *
   * Причина — дубль в сетке позиции: две строки с одним цветом и размером
   * (на бою `[{«—», 3XS:100}, {«—», 3XS:122}]`). Ключ строки таблицы у них
   * один, обе ячейки читают одно значение, а `cellsToGrid` их складывает —
   * то есть каждое нажатие клавиши удваивало число.
   */
  it('дубль в сетке даёт ОДНУ строку ввода, а не две с общим значением', () => {
    render(
      <PurchaseSizeTable
        plannedGrid={[
          { color: '—', sizes: { '3XS': 100 } },
          { color: '—', sizes: { '3XS': 122 } },
        ]}
        orderedGrid={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    // Потребность — сумма обеих строк, а не первая из них (в строке и в итоге)
    expect(screen.getAllByText('222')).toHaveLength(2);
  });

  it('введённое число не удваивается: 1 остаётся 1, следом 20 остаётся 20', () => {
    const onChange = vi.fn();
    const DUP = [
      { color: '—', sizes: { '3XS': 100 } },
      { color: '—', sizes: { '3XS': 122 } },
    ];
    const { rerender } = render(
      <PurchaseSizeTable plannedGrid={DUP} orderedGrid={null} onChange={onChange} />,
    );
    const field = () => screen.getByLabelText('3XS, Фактическое количество');

    fireEvent.change(field(), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith([{ color: '—', sizes: { '3XS': 1 } }]);

    // Родитель вернул сохранённое обратно — в поле обязана стоять единица
    rerender(
      <PurchaseSizeTable
        plannedGrid={DUP}
        orderedGrid={[{ color: '—', sizes: { '3XS': 1 } }]}
        onChange={onChange}
      />,
    );
    expect(field()).toHaveValue(1);

    // Очистили и набрали 20 — старое значение не дописывается к новому
    fireEvent.change(field(), { target: { value: '20' } });
    expect(onChange).toHaveBeenLastCalledWith([{ color: '—', sizes: { '3XS': 20 } }]);
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
