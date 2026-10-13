import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GridEditor from './GridEditor';

function Harness({ initial = { sizes: [], rows: [] }, onGrid }) {
  const [grid, setGrid] = useState(initial);
  return <GridEditor grid={grid} onChange={(g) => { setGrid(g); onGrid?.(g); }} />;
}

describe('GridEditor — сетка цвет × размер', () => {
  it('взрослый ряд, строка цвета, количество — тираж считается', () => {
    let last;
    render(<Harness onGrid={(g) => { last = g; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Взрослый' }));
    expect(last.sizes).toEqual(['S', 'M', 'L', 'XL']);
    fireEvent.click(screen.getByRole('button', { name: '+ Цвет' }));
    fireEvent.change(screen.getByLabelText('Цвет, строка 1'), { target: { value: 'Чёрный' } });
    fireEvent.change(screen.getByLabelText('Чёрный, M'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Чёрный, L'), { target: { value: '-5' } });
    expect(last.rows[0]).toEqual({ color: 'Чёрный', sizes: { M: 20, L: 0 } });
    expect(screen.getByTestId('grid-total').textContent).toBe('Тираж: 20 шт.');
  });

  it('размер выключается и включается, порядок — как в ряду', () => {
    let last;
    render(<Harness initial={{ sizes: ['S', 'M'], rows: [] }} onGrid={(g) => { last = g; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'XS' }));
    expect(last.sizes).toEqual(['XS', 'S', 'M']);
    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    expect(last.sizes).toEqual(['XS', 'M']);
  });

  it('без размеров цвет не добавить', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '+ Цвет' })).toBeDisabled();
  });

  it('один цвет дважды — предупреждение', () => {
    render(<Harness initial={{ sizes: ['S'], rows: [{ color: 'Белый', sizes: {} }, { color: 'белый', sizes: {} }] }} />);
    expect(screen.getByText(/указан дважды/)).toBeInTheDocument();
  });
});
