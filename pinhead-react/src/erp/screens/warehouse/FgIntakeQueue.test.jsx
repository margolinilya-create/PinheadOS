import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
