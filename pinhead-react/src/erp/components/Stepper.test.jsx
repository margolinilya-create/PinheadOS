import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from './Stepper';

// Счётчики выбраны вне диапазона индексов (1..3), чтобы номера шагов и counts не сталкивались.
const steps = [
  { key: 'a', label: 'Оплата', count: 7 },
  { key: 'b', label: 'В работе', count: 0 },
  { key: 'c', label: 'Готово', count: 12 },
];

describe('Stepper', () => {
  it('рендерит заголовок, номера шагов, подписи и счётчики', () => {
    render(<Stepper title="Воронка" steps={steps} />);
    expect(screen.getByText('Воронка')).toBeInTheDocument();
    ['1', '2', '3'].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument()); // номера
    ['Оплата', 'В работе', 'Готово'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    ['7', '0', '12'].forEach((c) => expect(screen.getByText(c)).toBeInTheDocument()); // счётчики
  });
});
