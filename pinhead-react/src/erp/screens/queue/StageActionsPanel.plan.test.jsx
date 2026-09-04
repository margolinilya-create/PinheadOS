import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StageActionsPanel } from './StageActionsPanel';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

attachDomainSlices();

/**
 * Б3 обхода 04.09 — половина, доступная интерфейсу.
 *
 * Один результат дня вводится в ДВУХ местах и это разные числа: очередь цеха
 * приращает `erp_item_stages.qty_done`, форма плана пишет абсолют за день
 * в `erp_calendar_slots.qty_done`. Связки нет ни триггером, ни расчётом —
 * цех, отчитавшийся в очереди, в плане остаётся «факт 0», и руководитель
 * видит невыполнение, которого нет.
 *
 * Выбор модели за владельцем (§10.2 отчёта). Но пока величины две, обе обязаны
 * быть ВИДНЫ на обеих поверхностях: молчащее расхождение хуже любой из моделей.
 */

const STAGE = {
  id: 'st1', item_id: 'i1', department_id: 'd1', status: 'in_progress',
  qty_done: 40, qty_rework: 0, planned_end: null, started_at: null, depends_on: [],
};
const ENTRY = {
  order: { id: 'o1', title: 'Заказ', due_date: '2026-09-30', launch_date: '2026-09-01' },
  item: { id: 'i1', qty: 100, product_type: 'Худи', stages: [STAGE] },
  stage: STAGE,
  group: 'in_progress',
};
const PERMS = {
  inDept: true, take: true, progress: true, complete: true,
  block: true, defect: true, skip: false, plan: false, any: true, needsDeptBinding: false,
};
const ACTIONS = Object.fromEntries(
  ['onStart', 'onDone', 'onProgress', 'onBlock', 'onUnblock', 'onDefect', 'onSkip', 'onAckOverdue']
    .map((k) => [k, vi.fn()]),
);

function seed(planSlots) {
  useErpStore.setState({
    departments: [{ id: 'd1', code: 'sewing', name: 'Швейный цех', is_production: true, active: true, sort_order: 1 }],
    orders: [ENTRY.order],
    planSlots,
    permissionMatrix: null,
    permissionsLoaded: true,
  });
}

const renderPanel = () => render(
  <MemoryRouter>
    <StageActionsPanel
      entry={ENTRY} perms={PERMS} deptShortById={new Map()} actions={ACTIONS} showTz={false} />
  </MemoryRouter>,
);

beforeEach(() => { seed([]); });

describe('очередь цеха: факт дня и факт этапа — два разных числа', () => {
  it('задача плана на сегодня показана рядом, и сказано, что число отдельное', () => {
    seed([{
      id: 'sl1', stage_id: 'st1', work_date: new Date().toISOString().slice(0, 10),
      qty_planned: 60, qty_done: 0, status: 'planned',
    }]);
    renderPanel();
    expect(screen.getByText(/В плане на сегодня: 60 план · 0 факт/)).toBeInTheDocument();
    expect(screen.getByText(/не считается из того, что вы запишете здесь/)).toBeInTheDocument();
  });

  it('плана на сегодня нет — строки нет', () => {
    renderPanel();
    expect(screen.queryByText(/В плане на сегодня/)).not.toBeInTheDocument();
  });

  /** Задача, снятая с плана, — не план: `status='cancelled'` вместо DELETE */
  it('снятая с плана задача не считается планом', () => {
    seed([{
      id: 'sl1', stage_id: 'st1', work_date: new Date().toISOString().slice(0, 10),
      qty_planned: 60, qty_done: 0, status: 'cancelled',
    }]);
    renderPanel();
    expect(screen.queryByText(/В плане на сегодня/)).not.toBeInTheDocument();
  });
});
