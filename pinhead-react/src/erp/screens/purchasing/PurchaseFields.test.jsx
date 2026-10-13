import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialCell, MaterialSizes, PlanField } from './PurchaseFields';

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 2: «Если позиция в заказе является готовым
 * изделием, закупка должна формироваться на основании самой позиции заказа…
 * В закупке это должна быть ОДНА закупка на 100 футболок с разбивкой внутри,
 * а не отдельная закупка на каждый размер».
 *
 * Сторож держит оба конца правки: разбивка ВИДНА в строке закупки (иначе
 * закупщик видит «100 шт» и не знает, каких размеров) и потребность
 * НЕ ПРАВИТСЯ руками (её считает триггер по сетке — второй писатель молча
 * разошёлся бы с сервером).
 */

const GARMENT = {
  id: 'm1', kind: 'finished_good', name: 'Футболка', color: 'чёрная',
  source: 'purchase', qty_expected: 100,
  size_grid: [{ color: '—', sizes: { XS: 10, S: 20, M: 30, L: 25, XL: 15 } }],
};

const FABRIC = {
  id: 'm2', kind: 'fabric', name: 'Кулирка 230', color: 'чёрный',
  source: 'purchase', qty_expected: 80, size_grid: null,
};

describe('строка закупки готового изделия', () => {
  // С 05.10 (п. 6) разбивка — в подробностях строки, а не в ячейке материала
  it('показывает разбивку по размерам у строки', () => {
    render(<MaterialSizes m={GARMENT} />);
    expect(screen.getByText(/XS 10 · S 20 · M 30 · L 25 · XL 15/)).toBeInTheDocument();
  });

  it('у обычного материала разбивки нет — строка не обрастает пустотой', () => {
    const { container } = render(<MaterialSizes m={FABRIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('вид «готовое изделие» подписан человеку', () => {
    render(<table><tbody><tr><td><MaterialCell m={GARMENT} /></td></tr></tbody></table>);
    expect(screen.getByText(/Готовое изделие/i)).toBeInTheDocument();
  });
});

describe('потребность при размерной сетке', () => {
  it('не правится руками: её считает триггер по сетке', () => {
    const onUpdate = vi.fn();
    render(<PlanField m={GARMENT} onUpdate={onUpdate} />);
    // Поля ввода нет вовсе — иначе правка «не сохранялась» бы молча
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('у материала без сетки поле осталось прежним', () => {
    render(<PlanField m={FABRIC} onUpdate={vi.fn()} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(80);
  });
});
