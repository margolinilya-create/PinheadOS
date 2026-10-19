import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useCutReport } from './useCutReport';
import { CutUsageSection } from './CutUsageSection';
import { CutResultTable } from './CutResultTable';
import { CutTotalsBar } from './CutTotalsBar';

/**
 * ЛИПКАЯ ПОЛОСА ИТОГОВ (правки 19.10): «Расход · Остаток · Средний» по
 * каждому материалу, один `role="status"`, обновление по `blur` и смене
 * режима, а не по каждой нажатой цифре.
 */

const FOOTER = { id: 'm-f', kind: 'fabric', name: 'Футер', color: 'чёрный' };
const RIB = { id: 'm-r', kind: 'fabric', name: 'Рибана', color: 'чёрный' };
const roll = (id, seq, materialId, left) => ({
  id, material_id: materialId, seq, label: `Рулон №${seq}`, status: 'in_stock', qty: 20,
  length_m: left, length_source: 'supplier', length_left_m: left, price_per_m: 100,
});
const OPTIONS = [
  { roll: roll('r-1', 1, 'm-f', 50), material: FOOTER, label: 'Рулон №1' },
  { roll: roll('r-2', 2, 'm-f', 50), material: FOOTER, label: 'Рулон №2' },
  { roll: roll('r-3', 3, 'm-f', 50), material: FOOTER, label: 'Рулон №3' },
  { roll: roll('r-4', 4, 'm-r', 10), material: RIB, label: 'Рулон №4' },
];
const ORDER = { id: 'o-1', items: [{ id: 'it-1', qty: 100, size_grid: [{ color: 'чёрный', sizes: { S: 100 } }] }] };

function Harness() {
  const cut = useCutReport({ stage: { id: 'st', item_id: 'it-1' }, order: ORDER, options: OPTIONS });
  return (
    <>
      <CutResultTable cut={cut} />
      <CutUsageSection cut={cut} options={OPTIONS} />
      <CutTotalsBar cut={cut} options={OPTIONS}><button type="button">Сдать результат</button></CutTotalsBar>
    </>
  );
}

describe('CutTotalsBar', () => {
  it('средний по материалу, один status', () => {
    render(<Harness />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Средний — введите годные в «Результат кроя»');

    const good = screen.getByRole('spinbutton', { name: 'Скроено, шт — S' });
    fireEvent.change(good, { target: { value: '100' } });
    fireEvent.blur(good);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Рулон №1 — использование' }))
      .getByRole('radio', { name: 'Полностью' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Рулон №2 — использование' }))
      .getByRole('radio', { name: 'Частично' }));
    const left = screen.getByLabelText('Остаток, м — рулон №2');
    fireEvent.change(left, { target: { value: '12' } });
    // До blur полоса не дёргается на каждую цифру: остаток ещё не учтён
    expect(status).toHaveTextContent('Расход 100 м');
    fireEvent.blur(left);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Рулон №2 — остаток' }))
      .getByRole('radio', { name: 'Остаток пригоден' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Рулон №4 — использование' }))
      .getByRole('radio', { name: 'Полностью' }));

    const footer = within(status).getByText(/^Футер · чёрный/);
    expect(footer).toHaveTextContent('Футер · чёрный: Расход 88 м · Остаток 62 м · Средний 0,88 м/шт');
    expect(within(status).getByText(/^Рибана · чёрный/))
      .toHaveTextContent('Рибана · чёрный: Расход 10 м · Остаток 0 м · Средний 0,10 м/шт');
    expect(screen.getByRole('button', { name: 'Сдать результат' })).toBeInTheDocument();
  });
});
