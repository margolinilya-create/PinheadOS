import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStageMove } from './useStageMove';
import { useErpStore } from '../store/useErpStore';
import { confirmWithInput } from '../../store/useConfirmStore';

/**
 * §2.5 обхода 04.09: перенос этапа в другой цех жил ТОЛЬКО на канбане, а вид
 * доски по умолчанию — таблица. Диспетчер, увидевший затор в очереди участка,
 * обязан был уйти на доску и переключить вид.
 *
 * Реализация одна на обе поверхности — иначе текст подтверждения и требование
 * причины разошлись бы с фактом, ровно то, ради чего `utils/stageMove`
 * и заведён отдельным модулем.
 */

vi.mock('../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../../store/useConfirmStore', () => ({
  confirm: vi.fn(async () => true),
  confirmWithInput: vi.fn(async () => ({ ok: true, value: null })),
}));

const DEPTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', is_production: true, active: true, sort_order: 1 },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', is_production: true, active: true, sort_order: 2 },
  { id: 'd-sup', code: 'supply', name: 'Закупка', is_production: false, active: true, sort_order: 0 },
  { id: 'd-off', code: 'vto', name: 'ВТО (выключен)', is_production: true, active: false, sort_order: 3 },
];

const ENTRY = {
  order: { id: 'o1', title: 'Заказ' },
  item: { id: 'i1', qty: 100, stages: [
    { id: 'st1', department_id: 'd-cut', status: 'in_progress', sort_order: 10, depends_on: [] },
  ] },
  stage: { id: 'st1', department_id: 'd-cut', status: 'in_progress', sort_order: 10, qty_done: 0, qty_rework: 0, depends_on: [] },
  group: 'in_progress',
};

function setup({ permissions = { 'stage.move_department': true } } = {}) {
  useErpStore.setState({
    departments: DEPTS,
    orders: [],
    myRole: 'production_head',
    myDeptId: 'd-cut',
    permissionMatrix: { production_head: permissions },
    permissionsLoaded: true,
    moveStageToDepartment: vi.fn(async () => true),
  });
  return renderHook(() => useStageMove());
}

beforeEach(() => { vi.mocked(confirmWithInput).mockClear(); });

describe('перенос этапа в другой цех — одна реализация', () => {
  it('цели — только активные производственные участки, кроме своего', () => {
    const { result } = setup();
    const codes = result.current.targetsFor(ENTRY.stage).map((d) => d.code);
    expect(codes).toEqual(['sewing']);
  });

  it('подтверждение спрашивается, и перенос уходит в стор', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.moveStageTo(ENTRY, DEPTS[1]);
    });
    expect(confirmWithInput).toHaveBeenCalledTimes(1);
    expect(useErpStore.getState().moveStageToDepartment)
      .toHaveBeenCalledWith('st1', 'd-sew', { comment: null });
  });

  it('без права перенос не идёт и диалога не показывает', async () => {
    const { result } = setup({ permissions: { 'stage.move_department': false } });
    expect(result.current.canMove(ENTRY.stage)).toBe(false);
    await act(async () => {
      await result.current.moveStageTo(ENTRY, DEPTS[1]);
    });
    expect(confirmWithInput).not.toHaveBeenCalled();
    expect(useErpStore.getState().moveStageToDepartment).not.toHaveBeenCalled();
  });

  it('перенос в свой же цех — не действие', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.moveStageTo(ENTRY, DEPTS[0]);
    });
    expect(confirmWithInput).not.toHaveBeenCalled();
  });
});
