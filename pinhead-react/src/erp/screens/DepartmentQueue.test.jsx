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
 * ПРАВКА 13.09, П. 2: служебной строки «У цеха: число — готово к запуску · …»
 * над рабочей областью больше нет.
 *
 * Сторож стоит на ОБОИХ прежних состояниях: и когда объяснять было нечего,
 * и когда легенда появлялась (у цеха есть «+N» — этап, ждущий предыдущего).
 * Второе — ровно тот случай, который прежняя редакция проверяла
 * положительно, и без него правку было бы нечем нарушить.
 */
describe('Очередь цеха — служебной подписи к числам вкладок нет', () => {
  it('у цеха только «готово к запуску» — подписи нет', () => {
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

  it('есть ожидание очереди — подписи по-прежнему нет, счётчик остался', () => {
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
    expect(screen.queryByText(/У цеха:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ожидают своей очереди/)).not.toBeInTheDocument();
    // Сам счётчик не тронут: правка убирала пояснение, а не числа
    expect(screen.getByLabelText(/ожидает: 1/)).toBeInTheDocument();
  });
});

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, ПП. 3 И 5 — очередь цеха.
 *
 * П. 5: «убрать отдельный текст/кнопку „Открыть" в списках задач. Название
 * сделки / заказа сделать основным кликабельным элементом: клик по названию
 * должен сразу открывать новый экран задачи». До правки название вело
 * на карточку ЗАКАЗА, а задание открывала отдельная кнопка в конце строки —
 * два перехода в одной строке, и нужный цеху был вторым.
 *
 * П. 3: одиночная иконка документа без подписи и без действия убрана.
 *
 * Проверяются ОБЕ раскладки: приём уже один раз доехал только до десктопной
 * (03.09, приоритет очереди), и разойтись им ничего не мешает.
 */
describe('Очередь цеха — открытие задания по названию сделки', () => {
  it.each([
    ['планшет (компактная раскладка)', true],
    ['десктоп', false],
  ])('%s: название сделки ведёт на задание, а не на заказ', (_name, compact) => {
    mockLayout(compact);
    renderQueue();
    const link = screen.getAllByRole('link', { name: /4821/ })[0];
    expect(link).toHaveAttribute('href', '/task/st1');
  });

  it.each([
    ['планшет (компактная раскладка)', true],
    ['десктоп', false],
  ])('%s: отдельной кнопки «Открыть» больше нет', (_name, compact) => {
    mockLayout(compact);
    renderQueue();
    expect(screen.queryByRole('link', { name: /^Открыть/ })).not.toBeInTheDocument();
    // И ни одной второй ссылки на то же задание: дублировать переход нельзя
    expect(screen.getAllByRole('link', { name: /4821/ })).toHaveLength(2);
  });

  it('одиночной иконки документа в строке нет (п. 3)', () => {
    mockLayout(false);
    renderQueue();
    /**
     * Иконка несла смысл ТОЛЬКО в `title` — на цеховом планшете его
     * не существует. Ищем по подписи, которой она объяснялась.
     */
    expect(screen.queryByTitle(/^ТЗ: /)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Есть ТЗ позиции')).not.toBeInTheDocument();
  });
});
