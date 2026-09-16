import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FgIntakeQueue } from './FgIntakeQueue';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, П. 6: «На экране склада в блоке „Приёмка готового
 * изделия" убрать поясняющий текст… Оставить только заголовок блока
 * и счётчик. Логику работы склада и зависимость от приёмки не менять».
 *
 * Сторож держит ОБА требования сразу: строки нет, а блок и его счётчик
 * на месте. Проверять только первое значило бы засчитать за исполнение
 * и случай, когда блок исчез целиком.
 */

const DEPTS = [
  {
    id: 'd-wh', code: 'warehouse', name: 'Склад',
    active: true, is_production: false, sort_order: 4, gate_material_kinds: [],
  },
];

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-09-20', tz_required: false, materials: [], procurement_tasks: [],
  items: [{
    id: 'i1', order_id: 'o1', product_type: 'Худи', qty: 100, garment_source: 'customer',
    stages: [{
      id: 'st-int', item_id: 'i1', department_id: 'd-wh', status: 'waiting',
      qty_done: 0, qty_rework: 0, depends_on: [], sort_order: 10,
      planned_end: null, started_at: null, finished_at: null,
    }],
  }],
};

beforeEach(() => {
  useErpStore.setState({
    orders: [ORDER],
    departments: DEPTS,
    bypasses: [],
    myDeptId: 'd-wh',
    myDeptLoaded: true,
    myRole: 'storekeeper',
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
    setStageStatus: vi.fn(async () => true),
  });
});

const renderQueue = () => render(
  <MemoryRouter><FgIntakeQueue /></MemoryRouter>,
);

describe('Приёмка готового изделия — шапка блока', () => {
  it('заголовок со счётчиком остался', () => {
    renderQueue();
    expect(screen.getByText('Приёмка готового изделия — 1')).toBeInTheDocument();
  });

  it('поясняющей строки под заголовком нет', () => {
    renderQueue();
    expect(screen.queryByText(/нужно принять ДО нанесения/)).not.toBeInTheDocument();
    expect(screen.queryByText(/цех нанесения работу не увидит/)).not.toBeInTheDocument();
  });

  it('сама очередь этапов не тронута — строка приёмки на месте', () => {
    renderQueue();
    // Зависимость держит ЭТАП маршрута, а не убранный текст
    expect(screen.getAllByText(/Худи/).length).toBeGreaterThan(0);
  });
});

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 1: «При нажатии „Принять изделие" сейчас сразу
 * появляется подтверждение завершения этапа, при этом система пишет, что
 * склад отчитался 0 из N… Нужно открывать окно „Результат приёмки"».
 *
 * Сторож держит оба конца: кнопка открывает ОКНО (а не закрывает этап)
 * и в окне уже стоит количество из заказа. Проверять только появление окна
 * значило бы засчитать за исполнение и пустую форму — ту самую, из-за
 * которой в журнале оставалось «0 из N».
 */
describe('Приёмка готового изделия — окно результата', () => {
  it('кнопка открывает окно, а не закрывает этап молча', async () => {
    const setStageStatus = vi.fn(async () => true);
    const submitStageReport = vi.fn(async () => true);
    useErpStore.setState({ setStageStatus, submitStageReport, loadMaterialReceipts: async () => [] });
    renderQueue();

    fireEvent.click(screen.getByRole('button', { name: /Принять изделие/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Ни один этап не закрыт одним нажатием — это и была жалоба документа
    expect(setStageStatus).not.toHaveBeenCalledWith(expect.anything(), 'done');
    expect(submitStageReport).not.toHaveBeenCalled();
  });

  it('в окно подтянут тираж из заказа', async () => {
    useErpStore.setState({ loadMaterialReceipts: async () => [] });
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: /Принять изделие/ }));

    const field = await screen.findByRole('spinbutton', { name: /Принято/ });
    expect(field).toHaveValue(100);
  });

  it('позиция с размерной сеткой даёт строку на каждый размер', async () => {
    useErpStore.setState({
      loadMaterialReceipts: async () => [],
      orders: [{
        ...ORDER,
        items: [{
          ...ORDER.items[0],
          size_grid: [{ color: '—', sizes: { XS: 10, S: 20, M: 15, L: 5 } }],
        }],
      }],
    });
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: /Принять изделие/ }));

    await screen.findByRole('dialog');
    const fields = screen.getAllByRole('spinbutton', { name: /Принято/ });
    expect(fields).toHaveLength(4);
    expect(fields.map((f) => f.value)).toEqual(['10', '20', '15', '5']);
  });

  it('недоприёмка уходит отчётом с фактическим числом, а не тиражом', async () => {
    const submitStageReport = vi.fn(async () => true);
    useErpStore.setState({
      submitStageReport,
      setStageStatus: vi.fn(async () => true),
      loadMaterialReceipts: async () => [],
    });
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: /Принять изделие/ }));

    const field = await screen.findByRole('spinbutton', { name: /Принято/ });
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.change(field, { target: { value: '47' } });

    expect(screen.getByText(/Принято 47 из 100/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить приёмку/ }));

    expect(submitStageReport).toHaveBeenCalledWith('st-int', expect.objectContaining({
      qtyGood: 47,
      qtyIn: 100,
    }));
  });

  it('нулевая приёмка не отправляется — причина названа рядом с кнопкой', async () => {
    const submitStageReport = vi.fn(async () => true);
    useErpStore.setState({ submitStageReport, loadMaterialReceipts: async () => [] });
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: /Принять изделие/ }));

    const field = await screen.findByRole('spinbutton', { name: /Принято/ });
    fireEvent.change(field, { target: { value: '' } });

    expect(screen.getByText(/сколько изделий фактически принято/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Подтвердить приёмку/ })).toBeDisabled();
    expect(submitStageReport).not.toHaveBeenCalled();
  });
});
