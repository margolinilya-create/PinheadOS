import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageIndicator } from './StageIndicator';

/**
 * Оба вида индикатора — один компонент. Тесты держат внешний вид каждого вида:
 * сведение реализаций не должно было ничего изменить на экранах.
 *
 * Вид `pipeline` удалён 12.08 вместе с фазовой моделью эксперим. цеха — его
 * тесты ушли с ним: тест, держащий вид без единого вызова, сторожит не экран,
 * а сам себя.
 */

// Счётчики выбраны вне диапазона индексов (1..3), чтобы номера шагов и counts не сталкивались.
const funnelNodes = [
  { key: 'a', label: 'Оплата', count: 7 },
  { key: 'b', label: 'В работе', count: 0 },
  { key: 'c', label: 'Готово', count: 12 },
];

describe('StageIndicator — воронка (подряд)', () => {
  it('рендерит заголовок, номера шагов, подписи и счётчики', () => {
    render(<StageIndicator variant="funnel" title="Воронка" nodes={funnelNodes} />);
    expect(screen.getByText('Воронка')).toBeInTheDocument();
    ['1', '2', '3'].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument()); // номера
    ['Оплата', 'В работе', 'Готово'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    ['7', '0', '12'].forEach((c) => expect(screen.getByText(c)).toBeInTheDocument()); // счётчики
  });
});

describe('StageIndicator — точки (карточка заказа)', () => {
  const dots = [
    { key: 's1', label: 'Закрой', state: 'done', lineDone: true, title: 'Закройный цех · Завершён' },
    { key: 's2', label: 'Швейка', state: 'active', title: 'Швейный цех · В работе' },
    { key: 's3', label: 'ВТО', title: 'ВТО цех · Ожидает' },
  ];

  it('пройденный этап помечен галочкой, остальные — номерами', () => {
    render(<StageIndicator variant="dots" nodes={dots} label="Лента этапов" />);
    // Галочка пройденного этапа — иконка Icon (svg), а не текстовый символ
    expect(screen.getByLabelText('Закройный цех · Завершён').querySelector('svg')).toBeTruthy();
    // нумерация продолжается по позиции в маршруте, а не по номеру непройденного
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('это список с доступным именем, а подсказка этапа доступна скринридеру', () => {
    render(<StageIndicator variant="dots" nodes={dots} label="Лента этапов" />);
    expect(screen.getByRole('list', { name: 'Лента этапов' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByLabelText('Швейный цех · В работе')).toBeInTheDocument();
  });
});
