import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DepartmentQueue from './DepartmentQueue';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ПРОВОДКА УПРАВЛЕНИЯ ОЧЕРЕДЬЮ В ОБЕ РАСКЛАДКИ.
 *
 * `QueueCard.test.jsx` проверяет, что карточка УМЕЕТ рисовать приоритет
 * и «В план». Здесь проверяется то, на чём всё и сломалось: передаёт ли
 * их сам экран. До 03.09 компактная ветка (`isCompact`) монтировала
 * `QueueCard` вообще без этих пропсов, а десктопная — с ними; обе «работали»,
 * просто на планшете цеха управление очередью отсутствовало.
 *
 * Проверяются ОБЕ ветки одним и тем же ожиданием: разойдутся снова —
 * покраснеет ровно та, которую забыли.
 */

const DEPT = {
  id: 'd-cut', code: 'cutting', name: 'Закрой',
  active: true, is_production: true, sort_order: 1, gate_material_kinds: [],
};

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-09-20', tz_required: false, materials: [], procurement_tasks: [],
  items: [{
    id: 'i1', order_id: 'o1', product_type: 'Худи', variant: 'чёрное', qty: 100,
    stages: [
      {
        id: 'st1', item_id: 'i1', department_id: DEPT.id, status: 'waiting',
        qty_done: 0, qty_rework: 0, depends_on: [], sort_order: 10,
        queue_position: 10, planned_end: null, started_at: null, finished_at: null,
      },
      {
        id: 'st2', item_id: 'i1', department_id: DEPT.id, status: 'waiting',
        qty_done: 0, qty_rework: 0, depends_on: [], sort_order: 20,
        queue_position: 20, planned_end: null, started_at: null, finished_at: null,
      },
    ],
  }],
};

const loadAll = vi.fn(async () => true);

function setStore() {
  useErpStore.setState({
    departments: [DEPT],
    orders: [ORDER],
    loaded: true,
    loadError: false,
    loadAll,
    myDeptId: DEPT.id,
    // Руководитель производства: у него есть и `stage.priority`, и `plan.manage`
    myRole: 'production_head',
    myDeptLoaded: true,
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
    bypasses: [],
    employees: [],
    employeesLoaded: true,
    loadEmployees: vi.fn(async () => true),
    loadStageReworkEvents: vi.fn(async () => ({})),
    reorderStageQueue: vi.fn(async () => true),
    planSlots: [],
    planLoaded: true,
  });
  useAuthStore.setState({ user: { id: 'u1', name: 'Иван', role: 'production' } });
}

/**
 * Компактная раскладка включается `matchMedia` — в jsdom его нет вовсе,
 * поэтому по умолчанию отдаётся десктоп. Заводим руками обе ветки.
 */
function mockLayout(compact) {
  window.matchMedia = (query) => ({
    matches: compact, media: query, addEventListener() {}, removeEventListener() {},
  });
}

const renderQueue = () => render(
  <MemoryRouter initialEntries={[`/queue/${DEPT.code}`]}>
    <Routes><Route path="/queue/:deptCode" element={<DepartmentQueue />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { setStore(); });
afterEach(() => { delete window.matchMedia; });

describe('Очередь цеха — управление приоритетом в обеих раскладках', () => {
  it.each([
    ['планшет (компактная раскладка)', true],
    ['десктоп', false],
  ])('%s: кнопки приоритета доступны', (_name, compact) => {
    mockLayout(compact);
    renderQueue();
    expect(screen.getAllByRole('button', { name: /Поднять приоритет/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Опустить приоритет/ }).length).toBeGreaterThan(0);
  });

  it.each([
    ['планшет (компактная раскладка)', true],
    ['десктоп', false],
  ])('%s: «Поставить в план» доступно', (_name, compact) => {
    mockLayout(compact);
    renderQueue();
    expect(screen.getAllByRole('button', { name: /Поставить в план/ }).length).toBeGreaterThan(0);
  });

  /**
   * §3.1 обхода 04.09: один тап ↑ — одна позиция и один запрос, а после
   * каждого карточка меняет место. Поднять шестое задание на первое стоило
   * пять тапов по уезжающей из-под пальца цели, притом что просят обычно
   * именно «сделай следующим». Кнопка обязана быть в ОБЕИХ раскладках:
   * прошлый раз (03.09) компактная ветка не получила ни приоритета, ни «В план».
   */
  it.each([
    ['планшет (компактная раскладка)', true],
    ['десктоп', false],
  ])('%s: «В начало очереди» — одно действие', async (_name, compact) => {
    mockLayout(compact);
    const reorder = vi.fn(async () => true);
    useErpStore.setState({ reorderStageQueue: reorder });
    renderQueue();
    const buttons = screen.getAllByRole('button', { name: /В начало очереди/ });
    expect(buttons.length).toBeGreaterThan(0);
    // Второе задание в начало: один запрос, а не «столько, сколько позиций»
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    expect(reorder.mock.calls[0][1]).toBeNull();
  });
});

/**
 * §2.7 обхода 04.09: у вкладки цеха три разных числа, и смысл каждого объяснял
 * `title`. На планшете наведения не существует — «+2» рядом с «4» не читалось
 * никак, при том что скринридер получал `aria-label`: слабее всех оказывался
 * зрячий человек с планшетом, ради которого пилот и запущен.
 *
 * Подпись показывается, только когда есть что объяснять: постоянная строка
 * служебного текста над рабочей областью — шум.
 */
describe('Очередь цеха — числа у вкладки названы видимым текстом', () => {
  it('пока у цеха только «готово к запуску» — подписи нет', () => {
    // Оба этапа фикстуры `waiting` без предшественников, то есть готовы
    useErpStore.setState({
      orders: [{
        ...ORDER,
        items: [{ ...ORDER.items[0], stages: [ORDER.items[0].stages[0]] }],
      }],
    });
    renderQueue();
    expect(screen.queryByText(/У цеха:/)).not.toBeInTheDocument();
  });

  it('появилось ожидание очереди — подпись объясняет «+N»', () => {
    const [first, second] = ORDER.items[0].stages;
    useErpStore.setState({
      orders: [{
        ...ORDER,
        items: [{
          ...ORDER.items[0],
          // Второй этап ждёт первого — это и есть «+N» на вкладке
          stages: [first, { ...second, depends_on: [first.id] }],
        }],
      }],
    });
    renderQueue();
    expect(screen.getByText(/ожидают своей очереди/)).toBeInTheDocument();
  });
});
