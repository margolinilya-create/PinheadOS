import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DevBoard } from './DevBoard';

/**
 * ЧТО КАРТОЧКА ДОСКИ ЭКС ПОКАЗЫВАЕТ, А ЧТО НЕТ (правка заказчика 20.09, п. 3).
 *
 * «Убрать из визуала карточек на доске надписи… Номер и название изделия
 * остаются».
 *
 * Сторож нужен именно здесь: снятые подписи — это ОТСУТСТВИЕ разметки,
 * а отсутствие само себя не защищает. Данные при этом никуда не делись
 * (они в карточке разработки), и вернуть строку «ответственный» на доску
 * ничего не стоит — тест называет цену такого возврата.
 */
const DEV = {
  id: 'dev1',
  tech_name: 'Худи оверсайз',
  dev_type: 'вариант цвета',
  technologist: 'Иванов',
  constructor: 'Петров',
  due_date: '2026-09-30',
  outcome: null,
  order: { id: 'o1', bitrix_id: '63634', title: 'Одноклассники сентябрь' },
};

const ROW = {
  dev: DEV,
  tasks: [],
  states: [],
  column: 'patterns',
  typeNames: {},
  materialGate: { open: true },
  hasBranding: false,
  today: '2026-09-20',
};

function renderBoard() {
  return render(
    <MemoryRouter>
      <DevBoard
        columns={[{ stage: 'patterns', total: 1, lanes: [{ lane: 'ready', rows: [ROW] }] }]}
        rows={[ROW]}
        canManage
        onMove={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('карточка доски ЭКС: номер и название остаются, подписи сняты', () => {
  it('номер сделки и название изделия на месте', () => {
    renderBoard();
    expect(screen.getByText('№63634')).toBeInTheDocument();
    expect(screen.getByText('Худи оверсайз')).toBeInTheDocument();
  });

  it('тип разработки, ответственный и «следующее действие» с доски убраны', () => {
    renderBoard();
    expect(screen.queryByText('вариант цвета')).not.toBeInTheDocument();
    expect(screen.queryByText(/Иванов/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Петров/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ответственный не назначен/)).not.toBeInTheDocument();
  });

  it('кнопки переноса остаются — без них доска не работает с клавиатуры', () => {
    renderBoard();
    expect(screen.getByText('‹')).toBeInTheDocument();
    expect(screen.getByText('›')).toBeInTheDocument();
  });
});
