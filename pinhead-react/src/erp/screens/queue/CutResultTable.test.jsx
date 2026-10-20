import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useCutReport } from './useCutReport';
import { CutResultTable } from './CutResultTable';

/**
 * «РЕЗУЛЬТАТ КРОЯ» (правки 19.10, Р5): выпуск вводится ОДИН раз — сеткой
 * позиции, а не на каждом рулоне. Два материала (полотно + рибана) не
 * удваивают таблицу и не удваивают годные.
 */

const FOOTER = { id: 'm-f', kind: 'fabric', name: 'Футер', color: 'чёрный' };
const RIB = { id: 'm-r', kind: 'fabric', name: 'Рибана', color: 'чёрный' };
const roll = (id, seq, materialId) => ({
  id, material_id: materialId, seq, label: `Рулон №${seq}`, status: 'in_stock', qty: 20,
  length_m: 50, length_source: 'supplier', length_left_m: 50, price_per_m: 100,
});
const OPTIONS = [
  { roll: roll('r-1', 1, 'm-f'), material: FOOTER, label: 'Рулон №1' },
  { roll: roll('r-2', 2, 'm-r'), material: RIB, label: 'Рулон №2' },
];
const STAGE = { id: 'st-1', item_id: 'it-1' };

function Harness({ grid, reported = {}, onCut }) {
  const order = { id: 'o-1', items: [{ id: 'it-1', qty: 100, size_grid: grid }] };
  const cut = useCutReport({ stage: STAGE, order, options: OPTIONS, reported });
  onCut?.(cut);
  return <CutResultTable cut={cut} />;
}

describe('CutResultTable — выпуск один раз', () => {
  it('сетка позиции один раз при двух материалах', () => {
    let last;
    render(<Harness grid={[{ color: 'чёрный', sizes: { S: 40, M: 60 } }]} onCut={(c) => { last = c; }} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const s = screen.getByRole('spinbutton', { name: 'Скроено, шт — S' });
    expect(screen.getAllByRole('spinbutton', { name: /Скроено, шт — S/ })).toHaveLength(1);
    fireEvent.change(s, { target: { value: '40' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Скроено, шт — M' }), { target: { value: '60' } });
    expect(last.goodTotal).toBe(100);
    expect(last.payload.sizes).toEqual([
      { color: 'чёрный', size: 'S', qty_good: 40 },
      { color: 'чёрный', size: 'M', qty_good: 60 },
    ]);
    const row = screen.getByRole('row', { name: /^S/ });
    expect(within(row).getByText('40')).toBeInTheDocument(); // «в заказе»
  });

  it('записано прежними сдачами — у строки размера', () => {
    render(<Harness grid={[{ color: '—', sizes: { S: 40 } }]} reported={{ '—\u0000S': 25 }} />);
    expect(screen.getByRole('row', { name: /^S/ })).toHaveTextContent('записано 25');
  });

  it('размер вне заказа', () => {
    let last;
    render(<Harness grid={[{ color: '—', sizes: { S: 40 } }]} onCut={(c) => { last = c; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Размер вне заказа…' }));
    const input = screen.getByRole('textbox', { name: 'Размер вне заказа' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '3xl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить размер' }));
    const added = screen.getByRole('spinbutton', { name: 'Скроено, шт — 3XL' });
    expect(screen.getByRole('row', { name: /^3XL/ })).toHaveTextContent('вне заказа');
    fireEvent.change(added, { target: { value: '2' } });
    expect(last.payload.sizes).toEqual([{ color: '—', size: '3XL', qty_good: 2 }]);
  });

  it('без сетки — предупреждение и только «Размер вне заказа…»', () => {
    render(<Harness grid={null} />);
    expect(screen.getByText(/У позиции нет размерной сетки/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Размер вне заказа…' })).toBeInTheDocument();
  });

  it('скроено больше заказа — плюс отдельной строкой', () => {
    render(<Harness grid={[{ color: '—', sizes: { S: 40 } }]} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Скроено, шт — S' }), { target: { value: '45' } });
    expect(screen.getByText(/Плюс: S — 5 шт/)).toBeInTheDocument();
  });
});
