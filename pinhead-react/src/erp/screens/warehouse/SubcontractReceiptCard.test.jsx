import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubcontractReceiptCard } from './SubcontractReceiptCard';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

// Карточка рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Приёмка подряда складом (правки заказчика 20.08).
 *
 * ЗАЧЕМ СТОРОЖ ИМЕННО ЗДЕСЬ. Это ЕДИНСТВЕННЫЙ путь, которым подрядный этап
 * закрывается: `qty_done` ему приращает только запись журнала `accept`
 * (триггер `erp_subcontract_moves_rollup`), а следующий этап открывается
 * обычным `depends_on`. До 20.08 задача склада для подрядных ЭТАПОВ маршрута
 * не создавалась вовсе — раздел выглядел рабочим, а производство стояло.
 *
 * Второе, что проверяется, — ПОРЯДОК: журнал раньше закрытия задачи. Обратный
 * порядок закрыл бы приёмку, не посчитав принятое, и следующий этап открылся
 * бы на пустом месте.
 */

const DEPTS = [
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true, is_production: true },
  { id: 'd-vto', code: 'vto', name: 'ВТО цех', active: true, is_production: true },
];

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  items: [{
    id: 'i1', product_type: 'Худи', variant: 'чёрное', qty: 500,
    stages: [
      {
        id: 's1', item_id: 'i1', department_id: 'd-sew', sort_order: 10, depends_on: [],
        status: 'in_progress', qty_done: 0, qty_rework: 0,
        executor: 'contractor', contractor: 'ООО Варка', operation: 'Варка',
      },
      {
        id: 's2', item_id: 'i1', department_id: 'd-vto', sort_order: 20, depends_on: ['s1'],
        status: 'waiting', qty_done: 0, qty_rework: 0,
        executor: 'internal', contractor: null, operation: null,
      },
    ],
  }],
};

/** Операция подряда при этапе: 200 передано, 200 вернулось, ничего не принято */
const SUB = {
  id: 'sc1', order_id: 'o1', item_id: 'i1', stage_id: 's1',
  operation: 'Варка', contractor: 'ООО Варка', qty: 500, phase: 'returned',
  qty_sent: 200, qty_returned: 200, qty_accepted: 0,
};

const TASK = {
  id: 'wt1', order_id: 'o1', item_id: 'i1', stage_id: 's1',
  task_type: 'subcontract_receipt', status: 'awaiting_receipt',
};

const addSubcontractMove = vi.fn(async () => true);
const onAdvance = vi.fn(async () => true);

beforeEach(() => {
  addSubcontractMove.mockClear();
  onAdvance.mockClear();
  useErpStore.setState({
    departments: DEPTS,
    subcontracting: [SUB],
    addSubcontractMove,
  });
});

const renderCard = (task = TASK) =>
  render(<SubcontractReceiptCard order={ORDER} task={task} onAdvance={onAdvance} />);

describe('карточка приёмки подряда', () => {
  it('показывает то, что документ перечисляет складу', () => {
    const { container } = renderCard();
    const text = container.textContent;
    // Изделие и тираж
    expect(text).toContain('Худи');
    expect(text).toContain('тираж 500');
    // Операция и подрядчик — без них склад не знает, что принимает
    expect(text).toContain('Варка');
    expect(text).toContain('ООО Варка');
    // Количества берутся из ЖУРНАЛА, а не из полей задачи
    expect(text).toMatch(/Передано:\s*200/);
    expect(text).toMatch(/вернулось:\s*200/);
  });

  it('называет СЛЕДУЮЩИЙ этап — приёмка не конечная точка', () => {
    /**
     * Главное требование документа («вернулось от подрядчика ≠ заказ готов»)
     * получается по построению: следующий этап уже в маршруте и зависит
     * от подрядного. Карточка его ПОКАЗЫВАЕТ, а не вычисляет переход.
     */
    const { container } = renderCard();
    expect(container.textContent).toMatch(/Следующий этап:\s*ВТО/);
  });

  it('не вернувшееся считается, а не вводится', () => {
    // «Передано − вернулось» и «вернулось − принято» выводятся из журнала:
    // вторая пара счётчиков рядом с ним = два писателя одного числа
    useErpStore.setState({
      subcontracting: [{ ...SUB, qty_sent: 200, qty_returned: 180 }],
    });
    const { container } = renderCard();
    expect(container.textContent).toContain('не вернулось: 20');
  });

  it('без числа принятого приёмку подтвердить нельзя', () => {
    renderCard();
    const btn = screen.getByRole('button', { name: /Подтвердить приёмку/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/это число открывает следующий этап/)).toBeInTheDocument();
  });

  it('приёмка пишет журнал `accept` и ТОЛЬКО ПОТОМ закрывает задачу', async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Сколько принято'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить приёмку/ }));

    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
    expect(addSubcontractMove).toHaveBeenCalledWith('sc1', expect.objectContaining({
      kind: 'accept', qty: 200,
    }));
    // Порядок: журнал приращает qty_done этапа, и только после этого задача
    // закрывается. Иначе следующий этап открылся бы, не посчитав принятое
    const moveAt = addSubcontractMove.mock.invocationCallOrder[0];
    const advanceAt = onAdvance.mock.invocationCallOrder[0];
    expect(moveAt).toBeLessThan(advanceAt);
    expect(onAdvance).toHaveBeenCalledWith('wt1', 'accepted');
  });

  it('неудачная запись журнала НЕ закрывает задачу', async () => {
    // Иначе на экране приёмка закрыта, а в производстве этап открыт —
    // ровно то состояние, из-за которого раздел «Подряд» был тупиком
    addSubcontractMove.mockResolvedValueOnce(false);
    renderCard();
    fireEvent.change(screen.getByLabelText('Сколько принято'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить приёмку/ }));

    await waitFor(() => expect(addSubcontractMove).toHaveBeenCalled());
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('частичная приёмка называет, сколько уйдёт в брак', () => {
    // Документ: брак возвращается подрядчику на переделку, а вернуть можно
    // только то, что посчитано
    renderCard();
    fireEvent.change(screen.getByLabelText('Сколько принято'), { target: { value: '150' } });
    expect(screen.getByText(/В брак уйдёт: 50/)).toBeInTheDocument();
  });

  it('принятая задача полей ввода не показывает', () => {
    renderCard({ ...TASK, status: 'accepted' });
    expect(screen.queryByLabelText('Сколько принято')).not.toBeInTheDocument();
    expect(screen.getByText(/следующий этап маршрута открыт/)).toBeInTheDocument();
  });
});
