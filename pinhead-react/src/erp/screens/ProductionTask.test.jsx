import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductionTask from './ProductionTask';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

attachDomainSlices();

/**
 * §6.2 обхода 04.09 (блокер Б4): страница задания монтирует ту же панель
 * действий, что строка очереди, и своей роли не имела. Очередь отвечает
 * «что взять следующим», страница — «работаю над этим», а отвечать на второй
 * вопрос она начинала ТРЕТЬИМ экраном: сверху справка «Задание» и «Маршрут
 * и прогресс», ТЗ и кнопки под ними. На 768×1024, ради которых пилот
 * и запущен, это прокрутка до того, ради чего сюда пришли.
 *
 * Сторож смотрит ПОЛОЖЕНИЕ В ДОКУМЕНТЕ: наличие блока было и до правки.
 */

const DEPT = {
  id: 'd1', code: 'sewing', name: 'Швейный цех',
  is_production: true, active: true, sort_order: 1, gate_material_kinds: [],
};
const STAGE = {
  id: 'st1', item_id: 'i1', department_id: 'd1', status: 'in_progress',
  qty_done: 10, qty_rework: 0, depends_on: [], sort_order: 10,
  planned_end: null, started_at: null, finished_at: null, executor: 'internal',
};
const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-09-30', launch_date: '2026-09-01', tz_required: false,
  materials: [], procurement_tasks: [], attachments: [], warehouse_tasks: [],
  items: [{ id: 'i1', order_id: 'o1', product_type: 'Худи', variant: 'чёрное', qty: 100, stages: [STAGE], prints: [] }],
};

beforeEach(() => {
  useErpStore.setState({
    orders: [ORDER],
    departments: [DEPT],
    loaded: true,
    loadError: null,
    loadAll: vi.fn(async () => true),
    loadOne: vi.fn(async () => true),
    myDeptId: 'd1',
    myDeptLoaded: true,
    myRole: 'worker',
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
    bypasses: [],
    planSlots: [],
    employees: [],
    employeesLoaded: true,
    loadEmployees: vi.fn(async () => true),
    loadStageReworkEvents: vi.fn(async () => ({})),
  });
});

const renderTask = () => render(
  <MemoryRouter initialEntries={['/task/st1']}>
    <Routes><Route path="/task/:stageId" element={<ProductionTask />} /></Routes>
  </MemoryRouter>,
);

describe('страница производственного задания', () => {
  it('ТЗ и действия стоят выше справки и маршрута', () => {
    renderTask();
    const tz = screen.getByText('ТЗ и действия');
    const facts = screen.getByText('Задание');
    const route = screen.getByText('Маршрут и прогресс');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(tz.compareDocumentPosition(facts) & FOLLOWING).toBeTruthy();
    expect(tz.compareDocumentPosition(route) & FOLLOWING).toBeTruthy();
  });

  /** Справка не убрана — она уехала вниз: к ней возвращаются глазами */
  it('справка и маршрут остались на странице', () => {
    renderTask();
    expect(screen.getByText('Задание')).toBeInTheDocument();
    expect(screen.getByText('Маршрут и прогресс')).toBeInTheDocument();
  });
});
