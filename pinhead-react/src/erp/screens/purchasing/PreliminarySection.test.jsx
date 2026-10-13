import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreliminarySection } from './PreliminarySection';
import { useErpStore } from '../../store/useErpStore';
import { useConfirmStore } from '../../../store/useConfirmStore';
import { attachDomainSlices } from '../../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Предварительная закупка до запуска заказа (п. 17 документа 16.08).
 *
 * ГЛАВНОЕ, ЧТО ПРОВЕРЯЕТСЯ, — привязка НЕ СОЗДАЁТ вторую строку. Документ
 * требует этого прямо: «система при этом не должна создавать вторую
 * дублирующую закупку». Скопировать строку было бы проще, и именно поэтому
 * поведение нужно сторожить, а не полагаться на память.
 */

const ORDERS = [
  { id: 'o1', status: 'active', title: 'Худи «Ромашка»', bitrix_id: '4821' },
  { id: 'o2', status: 'done_on_time', title: 'Архивный', bitrix_id: '4700' },
];

const ROW = {
  id: 'm1', order_id: null, kind: 'fabric', name: 'Футер 320',
  color: 'чёрный', qty_expected: 100, unit: 'кг', notes: 'взяли заранее',
  created_at: '2026-08-16T10:00:00Z',
};

function setup({ preliminary = [ROW] } = {}) {
  const attachPreliminaryToOrder = vi.fn().mockResolvedValue(true);
  const addPreliminaryMaterial = vi.fn().mockResolvedValue(ROW);
  useErpStore.setState({
    preliminary,
    preliminaryLoaded: true,
    loadPreliminary: vi.fn(),
    addPreliminaryMaterial,
    attachPreliminaryToOrder,
    dictionaries: [],
  });
  render(<PreliminarySection orders={ORDERS} />);
  return { attachPreliminaryToOrder, addPreliminaryMaterial };
}

describe('Предварительные закупки', () => {
  beforeEach(() => {
    useErpStore.setState({ preliminary: [], dictionaries: [] });
    // Подтверждение отвечает «да» без участия человека
    useConfirmStore.setState({ open: false });
  });

  it('строка без заказа видна со своим количеством и комментарием', () => {
    setup();
    expect(screen.getByText('Футер 320')).toBeInTheDocument();
    expect(screen.getByText(/100 кг/)).toBeInTheDocument();
    expect(screen.getByText('взяли заранее')).toBeInTheDocument();
  });

  /**
   * Привязка идёт к СУЩЕСТВУЮЩЕЙ строке — действие получает её id, а не
   * копию полей. Копия и есть та самая «вторая дублирующая закупка».
   */
  it('привязка отдаёт id существующей строки, а не заводит новую', async () => {
    const { attachPreliminaryToOrder, addPreliminaryMaterial } = setup();
    const select = screen.getByLabelText('Привязать «Футер 320» к заказу');
    fireEvent.change(select, { target: { value: 'o1' } });

    /**
     * Диалог подтверждения живёт в оболочке приложения и в этом тесте
     * не смонтирован — отвечаем «да» через сам стор. Так проверяется именно
     * поведение секции, а не разметка чужого компонента.
     */
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(true);

    await waitFor(() => expect(attachPreliminaryToOrder).toHaveBeenCalledWith('m1', 'o1'));
    expect(addPreliminaryMaterial).not.toHaveBeenCalled();
  });

  /** Отказ в подтверждении не должен ничего менять */
  it('отмена подтверждения не привязывает', async () => {
    const { attachPreliminaryToOrder } = setup();
    fireEvent.change(screen.getByLabelText('Привязать «Футер 320» к заказу'),
      { target: { value: 'o1' } });
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(false);
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(false));
    expect(attachPreliminaryToOrder).not.toHaveBeenCalled();
  });

  /**
   * Привязывать можно только к активному заказу: архивный уже отгружен,
   * и закупка для него смысла не имеет.
   */
  it('в списке заказов только активные', () => {
    setup();
    const select = screen.getByLabelText('Привязать «Футер 320» к заказу');
    expect(select).toHaveTextContent('Худи «Ромашка»');
    expect(select).not.toHaveTextContent('Архивный');
  });

  it('пустой список говорит об этом, а не показывает пустую таблицу', () => {
    setup({ preliminary: [] });
    expect(screen.getByText('Предварительных закупок нет.')).toBeInTheDocument();
  });

  it('материал без названия не создаётся', () => {
    const { addPreliminaryMaterial } = setup({ preliminary: [] });
    fireEvent.click(screen.getByRole('button', { name: /\+ Предварительная закупка/ }));
    expect(addPreliminaryMaterial).not.toHaveBeenCalled();
  });
});
