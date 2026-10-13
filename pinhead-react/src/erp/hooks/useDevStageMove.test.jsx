import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDevStageMove } from './useDevStageMove';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';

/**
 * §3.6 обхода 04.09: со СТРАНИЦЫ разработки карточку нельзя было перенести
 * между колонками, хотя диалоги переноса обещают «перейдёт», а страница
 * с 22.08 — основное место работы технолога (шторку заказчик отверг).
 *
 * Всё жило в `Experimental.jsx`: закрытие покидаемого этапа, вопрос
 * о названии лекал, заведение задач нанесений. Порядок этих шагов держит
 * работу образцов, заведённых до 02.09, и повторение его на второй
 * поверхности разошлось бы молча — поэтому реализация одна.
 */

vi.mock('../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../../store/useConfirmStore', () => ({
  confirm: vi.fn(async () => true),
  confirmWithInput: vi.fn(async () => ({ ok: true, value: 'ЛК-2026-01' })),
}));

const DEV = {
  id: 'dev1', order_id: 'o1', item_id: 'i1', outcome: null,
  board_stage: 'cutting', pattern_tech_name: 'ЛК-1', tasks: [],
};

function setup() {
  useErpStore.setState({
    experimental: [DEV],
    orders: [{ id: 'o1', items: [{ id: 'i1', qty: 10, prints: [], stages: [] }], materials: [] }],
    departments: [],
    updateExperimental: vi.fn(async () => true),
    addDevTasks: vi.fn(async () => []),
    sendDevTaskToDept: vi.fn(async () => true),
    reportProgress: vi.fn(async () => true),
  });
  return renderHook(() => useDevStageMove());
}

const CTX = {
  devId: 'dev1', from: 'cutting', outcome: null, canManage: true,
  materialsPending: false, hasBranding: false, brandingOpen: false,
};

beforeEach(() => { vi.mocked(toast.error).mockClear(); });

describe('перенос карточки разработки — одна реализация', () => {
  it('разрешённый ход записывает колонку', async () => {
    const { result } = setup();
    await act(async () => { await result.current.requestMove(CTX, 'sewing'); });
    expect(useErpStore.getState().updateExperimental)
      .toHaveBeenCalledWith('dev1', { board_stage: 'sewing' });
  });

  /** Молча не сработавший перенос человек повторяет ещё трижды */
  it('запрещённый ход называет причину и колонку не пишет', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.requestMove({ ...CTX, canManage: false }, 'sewing');
    });
    expect(toast.error).toHaveBeenCalled();
    expect(useErpStore.getState().updateExperimental).not.toHaveBeenCalled();
  });

  /** «Карточка уже здесь» — обычный исход броска мимо, а не ошибка */
  it('ход в тот же шаг молчит', async () => {
    const { result } = setup();
    await act(async () => { await result.current.requestMove(CTX, 'cutting'); });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
