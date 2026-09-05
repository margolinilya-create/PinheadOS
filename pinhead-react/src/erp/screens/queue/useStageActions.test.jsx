import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStageActions } from './useStageActions';
import { useErpStore } from '../../store/useErpStore';
import { toast } from '../../../store/useToastStore';

vi.mock('../../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../store/useConfirmStore', () => ({
  confirm: vi.fn(async () => true),
  confirmWithInput: vi.fn(async () => 'причина'),
}));

/**
 * ОБРАТНАЯ СВЯЗЬ У БРАКА (обход 04.09).
 *
 * Успешный возврат не давал НИКАКОГО отклика: слайс говорит только об ошибках,
 * панель просто закрывалась, а на карточке менялся невидимый `qty_rework`.
 * У самого неприятного действия смены это худшее из возможных молчаний —
 * рабочий не знал, записалось ли, и жал второй раз.
 */

const DEPTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех' },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех' },
];

const ENTRY = {
  order: { id: 'o1', title: 'Заказ' },
  item: {
    id: 'i1',
    qty: 100,
    stages: [
      { id: 'st-cut', department_id: 'd-cut', status: 'done', sort_order: 10 },
      { id: 'st-sew', department_id: 'd-sew', status: 'in_progress', sort_order: 20 },
    ],
  },
  stage: { id: 'st-sew', department_id: 'd-sew', status: 'in_progress', qty_done: 50 },
  group: 'in_progress',
};

function setup({ reportDefect = vi.fn(async () => true) } = {}) {
  useErpStore.setState({
    departments: DEPTS,
    orders: [],
    reportDefect,
    setStageStatus: vi.fn(async () => true),
    reportProgress: vi.fn(async () => true),
    uploadOrderAttachment: vi.fn(async () => true),
    moveStageToDepartment: vi.fn(async () => true),
    submitStageReport: vi.fn(async () => true),
    ackStageOverdue: vi.fn(async () => true),
  });
  const { result } = renderHook(() => useStageActions());
  return { result, reportDefect };
}

describe('действия цеха: подтверждение брака', () => {
  beforeEach(() => { vi.mocked(toast.success).mockReset(); });

  it('возврат на другой этап называет число и участок', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.onDefect(ENTRY, { qty: 7, reason: 'кривая строчка', target: 'st-cut' }, null);
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const text = vi.mocked(toast.success).mock.calls[0][0];
    expect(text).toMatch(/7 шт/);
    expect(text).toMatch(/Закрой|Закройный/);
  });

  it('переделка на своём этапе говорит именно это', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.onDefect(ENTRY, { qty: 3, reason: 'пятно', target: 'current' }, null);
    });
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/переделка на этом этапе/);
  });

  /** Неудача остаётся неудачей: о ней говорит слайс, и второго «успеха» быть не должно */
  it('при отказе слайса подтверждения нет', async () => {
    const { result } = setup({ reportDefect: vi.fn(async () => false) });
    await act(async () => {
      await result.current.onDefect(ENTRY, { qty: 2, reason: 'брак', target: 'current' }, null);
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
