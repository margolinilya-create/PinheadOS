import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

/**
 * §3.4 обхода 04.09: форма спрашивала статус приёмки РУКАМИ, и селект стоял
 * со значением «Принято полностью» по умолчанию — приёмка 60 из 120 уезжала
 * полной, если про него забыли. Проект от таких статусов уже ушёл дважды
 * (подряд, закупка): «статус ставится ПО ФАКТУ, а не выбирается рядом с ним».
 *
 * Из чисел выводится ровно то, что из них следует: закрыт план или нет.
 * «Пересорт» и «Не принято» — суждение кладовщика, и они остаются выбором.
 */
describe('приёмка: статус выводится из чисел', () => {
  const PLANNED = {
    ...MATERIAL, qty_expected: 120, unit: 'кг', status: 'received', qty_received: null,
  };
  const renderOne = (m) => render(
    <MaterialReceiptCard
      order={{ ...ORDER, materials: [m] }} task={TASK} onAccept={vi.fn()} />,
  );
  const qtyField = (m = PLANNED) => screen.getByLabelText(`Сколько пришло сейчас, ${m.name}`);
  const statusField = (m = PLANNED) => screen.getByLabelText(`Статус приёмки ${m.name}`);

  it('недобор плана предлагает «Принято частично», а не «полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '60' } });
    expect(statusField()).toHaveValue('accepted_partial');
    // Недостача названа и в таблице «План↔Факт», и в строке следствия
    expect(screen.getAllByText(/не хватает 60/).length).toBeGreaterThan(0);
  });

  it('план закрыт — «Принято полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(statusField()).toHaveValue('accepted_full');
    expect(screen.getByText(/план закрыт/)).toBeInTheDocument();
  });

  /** Суждение сильнее арифметики: пересорт из чисел не выводится вовсе */
  it('выбранный человеком статус числа больше не перебивают', () => {
    renderOne(PLANNED);
    fireEvent.change(statusField(), { target: { value: 'mismatch' } });
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(statusField()).toHaveValue('mismatch');
  });

  it('плана нет — судить не о чем, следствие не показывается', () => {
    const noPlan = { ...PLANNED, qty_expected: null };
    renderOne(noPlan);
    fireEvent.change(qtyField(noPlan), { target: { value: '60' } });
    expect(screen.queryByText(/будет принято/)).not.toBeInTheDocument();
    expect(statusField(noPlan)).toHaveValue('accepted_full');
  });
});
