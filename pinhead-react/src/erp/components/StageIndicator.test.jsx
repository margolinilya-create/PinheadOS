import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageIndicator } from './StageIndicator';

/**
 * Три вида индикатора — один компонент. Тесты держат внешний вид каждого вида:
 * сведение реализаций не должно было ничего изменить на экранах.
 */

// Счётчики выбраны вне диапазона индексов (1..3), чтобы номера шагов и counts не сталкивались.
const funnelNodes = [
  { key: 'a', label: 'Оплата', count: 7 },
  { key: 'b', label: 'В работе', count: 0 },
  { key: 'c', label: 'Готово', count: 12 },
];

const pipeNodes = [
  { key: 'p', label: 'Лекала', icon: 'scissors', count: 3 },
  { key: 'd', label: 'Проработка', icon: 'flask', count: 8 },
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

describe('StageIndicator — пайплайн (эксперим. цех)', () => {
  it('рендерит подписи фаз и счётчики', () => {
    render(<StageIndicator variant="pipeline" nodes={pipeNodes} />);
    expect(screen.getByText(/Лекала/)).toBeInTheDocument();
    expect(screen.getByText(/Проработка/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('боковой узел (aside) показывается только при count > 0', () => {
    const { queryByText, rerender } = render(
      <StageIndicator
        variant="pipeline"
        nodes={pipeNodes}
        aside={{ key: 'r', label: 'Возврат', icon: '↩', count: 0 }}
      />,
    );
    expect(queryByText(/Возврат/)).toBeNull();
    rerender(
      <StageIndicator
        variant="pipeline"
        nodes={pipeNodes}
        aside={{ key: 'r', label: 'Возврат', icon: '↩', count: 4 }}
      />,
    );
    expect(screen.getByText(/Возврат/)).toBeInTheDocument();
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
