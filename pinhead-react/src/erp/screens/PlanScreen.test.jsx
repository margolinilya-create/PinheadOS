import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PlanScreen from './PlanScreen';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ПРОИЗВОДСТВЕННЫЙ ПЛАН НА ПЛАНШЕТЕ ЦЕХА (15.09).
 *
 * До этой правки экран был единственным в разделе, который не знал про
 * `useCompactLayout`, и переносить задачу с понедельника на пятницу на
 * планшете было нечем:
 *   · перетаскивание — HTML5 DnD без полифилла, на тач-экране мёртв;
 *   · кнопки «‹ ›» ходят по СОСЕДЯМ — это четыре тапа по цели, которая
 *     после каждого уезжает из-под пальца;
 *   · поле даты в шторке — ввод даты руками вместо тапа.
 * Записанное правило проекта говорит об этом прямо: «Пока перетаскивание —
 * единственный способ перешагнуть, требование выполнено только мышью».
 *
 * Плюс вкладка по умолчанию («Все цеха») рисовала таблицу из двенадцати
 * колонок — первый кадр `/plan` на планшете.
 */

const DEPT = {
  id: 'd-cut', code: 'cutting', name: 'Закройный цех',
  active: true, is_production: true, sort_order: 1, gate_material_kinds: [],
};

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-07-24', launch_date: '2026-07-20',
  materials: [], procurement_tasks: [], developments: [],
  items: [{
    id: 'i1',
    order_id: 'o1',
    product_type: 'Худи',
    qty: 100,
    size_grid: null,
    prints: [],
    stages: [{
      id: 'st1',
      item_id: 'i1',
      department_id: DEPT.id,
      depends_on: [],
      status: 'ready',
      origin: 'production',
      qty_done: 0,
      qty_rework: 0,
      executor: 'internal',
      sort_order: 10,
      planned_start: null,
      planned_end: null,
    }],
  }],
};

/** Понедельник недели 20.07.2026 — тот же день, что у прочих спек плана */
const MONDAY = '2026-07-20';
const FRIDAY = '2026-07-24';

const SLOT = {
  id: 'slot-1',
  stage_id: 'st1',
  department_id: DEPT.id,
  work_date: MONDAY,
  qty_planned: 40,
  qty_done: 0,
  qty_defect: 0,
  status: 'planned',
  priority: 0,
  comment: null,
  problem_type: null,
  problem_note: null,
  assignee: null,
  sort_order: 10,
};

let movePlanSlot;

/**
 * Компактная раскладка включается `matchMedia` — в jsdom его нет вовсе,
 * поэтому по умолчанию отдаётся десктоп. Заводим руками обе ветки.
 */
function mockLayout(compact) {
  window.matchMedia = (query) => ({
    matches: compact, media: query, addEventListener() {}, removeEventListener() {},
  });
}

beforeEach(() => {
  movePlanSlot = vi.fn(async () => true);
  useErpStore.setState({
    orders: [ORDER],
    departments: [DEPT],
    loaded: true,
    loadError: null,
    loadAll: vi.fn(async () => true),
    planSlots: [SLOT],
    planLoaded: true,
    planLoadError: null,
    loadPlan: vi.fn(async () => true),
    movePlanSlot,
    planComments: [],
    // Мощность приезжает своим запросом (`erp_settings`); `null` здесь ронял бы
    // экран в `capacityReport` — полоса читает поле, а не строку целиком
    capacity: { monthly_units: null },
    capacityLoaded: true,
    loadSettings: vi.fn(async () => true),
    plannedStageIds: new Set(['st1']),
    plannedAheadLoaded: true,
    loadPlannedAhead: vi.fn(async () => true),
    bypasses: [],
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
    myDeptId: null,
    myDeptLoaded: true,
    myRole: 'production_head',
  });
});

afterEach(() => { delete window.matchMedia; });

const renderPlan = (search = `?week=${MONDAY}&dept=${DEPT.code}`) => render(
  <MemoryRouter initialEntries={[`/plan${search}`]}>
    <Routes><Route path="/plan" element={<PlanScreen />} /></Routes>
  </MemoryRouter>,
);

describe('План на планшете — перенос задачи', () => {
  it('понедельник → пятница: ОДИН вызов переноса, а не четыре', async () => {
    mockLayout(true);
    renderPlan();

    /**
     * Кнопок переноса на экране ДВЕ, и это не дубль: одна в карточке дня,
     * вторая — в блоке «Требуют решения», куда слот попадает как отклонение.
     * До 15.09 во втором блоке пути переноса не было вовсе, хотя решение,
     * которого он «требует», чаще всего именно перенос.
     */
    const open = (await screen.findAllByRole('button', { name: /Перенести задачу с .* на другой день/ }))[0];
    open.click();

    const dialog = await screen.findByRole('dialog');
    const friday = within(dialog).getByRole('button', { name: /Перенести на пятница/i });
    friday.click();

    /**
     * ЧИСЛО ВЫЗОВОВ И ЕСТЬ ПРОВЕРКА ПРАВИЛА «действие, которое просят
     * повторить N раз, стоит сделать одним». Текстом оно не сторожится:
     * кнопки «‹ ›» на месте и подписаны так же, разница только в том,
     * сколько запросов уходит на один перенос.
     */
    expect(movePlanSlot).toHaveBeenCalledTimes(1);
    expect(movePlanSlot).toHaveBeenCalledWith('slot-1', FRIDAY);
  });

  it('окно переноса доступно и в десктопной раскладке', async () => {
    // Иначе это «планшетный костыль», а не путь: руководитель работает
    // и с ноутбука, и перенос через полнедели ему нужен так же
    mockLayout(false);
    renderPlan();
    const open = await screen.findAllByRole('button', { name: /Перенести задачу с .* на другой день/ });
    expect(open.length).toBeGreaterThan(0);
  });

  it('текущий день задачи в окне выбрать нельзя', async () => {
    mockLayout(true);
    renderPlan();
    (await screen.findAllByRole('button', { name: /Перенести задачу с .* на другой день/ }))[0].click();

    const dialog = await screen.findByRole('dialog');
    const monday = within(dialog).getByRole('button', { name: /Перенести на понедельник/i });
    expect(monday).toBeDisabled();
  });
});

describe('План на планшете — сводка «Все цеха»', () => {
  it('в компактной раскладке рисуется карточками, а не таблицей', async () => {
    mockLayout(true);
    renderPlan(`?week=${MONDAY}`);

    expect(await screen.findByRole('listitem')).toBeTruthy();
    // Двенадцать колонок на 768px не помещаются, и «Ждут материалы»
    // с «Браком» уезжали за правый край
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Открыть цех' })).toBeTruthy();
  });

  it('в десктопной раскладке остаётся таблицей', async () => {
    mockLayout(false);
    renderPlan(`?week=${MONDAY}`);

    expect((await screen.findAllByRole('columnheader')).length).toBeGreaterThan(0);
  });
});
