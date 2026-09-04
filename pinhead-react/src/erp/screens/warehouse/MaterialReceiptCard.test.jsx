import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialReceiptCard } from './MaterialReceiptCard';

/**
 * Б5 обхода 04.09: кладовщику некуда принять ЧАСТИЧНУЮ поставку.
 *
 * Задача «Приёмка материалов» заводилась только при ЗАКРЫТИИ этапа закупки,
 * а закупка закрывается, когда разобраны все строки. Ткань от первого
 * поставщика пришла, бирки везут через неделю — и до конца закупки записать
 * первую поставку было НЕКУДА: единственный законный путь лежал через чужой
 * экран (очередь цеха). Триггер теперь заводит задачу с началом закупки
 * (`20260904181542`), и у карточки появилось состояние, которого раньше
 * не бывало, — строк ещё нет.
 */

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', materials: [] };
const TASK = { id: 't1', task_type: 'material_receipt', status: 'awaiting' };

const MATERIAL = {
  id: 'm1', name: 'Футер 3-нитка', kind: 'fabric', status: 'pending',
  qty_expected: 100, qty_received: null, accept_status: null,
};

describe('карточка приёмки материалов', () => {
  it('строк ещё нет — карточка говорит это словами, а не пустотой', () => {
    render(<MaterialReceiptCard order={ORDER} task={TASK} onAccept={vi.fn()} />);
    /**
     * Заголовок без содержимого читается как поломка: до правки такого
     * состояния не бывало вовсе, потому что задача появлялась после того,
     * как все строки уже разобраны.
     */
    expect(screen.getByText(/Закупка ещё не завела ни одной позиции/)).toBeInTheDocument();
  });

  it('строки есть — приёмка по каждой', () => {
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [MATERIAL] }} task={TASK} onAccept={vi.fn()} />,
    );
    // Название стоит и в шапке блока, и в колонке «План» — берём все
    expect(screen.getAllByText('Футер 3-нитка').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Закупка ещё не завела/)).not.toBeInTheDocument();
  });
});
