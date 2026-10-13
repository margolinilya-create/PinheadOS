import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BypassTab } from './BypassTab';
import { useErpStore } from '../../store/useErpStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { confirm } from '../../../store/useConfirmStore';

vi.mock('../../../store/useConfirmStore', () => ({ confirm: vi.fn() }));

/**
 * ОПАСНОЕ ДЕЙСТВИЕ БЫЛО ЗАЩИЩЕНО НАОБОРОТ (обход 04.09): возврат проверки —
 * действие безопасное — спрашивал подтверждение, а снятие, открывающее
 * производству работу без материалов или без ТЗ, выполнялось с первого
 * нажатия. И «Где» по умолчанию стояло «Вся система» — самый широкий вариант
 * при собственной подсказке «снимайте точечно».
 */

const ORDERS = [{ id: 'o1', status: 'active', title: 'Заказ №1', items: [], materials: [] }];

function setup({ createBypass = vi.fn(async () => ({ id: 'b1' })) } = {}) {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', name: 'A', role: 'admin', approved: true, active: true },
  });
  useErpStore.setState({
    bypasses: [], bypassesLoaded: true, bypassesError: null,
    loadBypasses: vi.fn(), createBypass, restoreBypass: vi.fn(),
    orders: ORDERS,
  });
  render(<BypassTab />);
  return { createBypass };
}

describe('аварийный режим: снятие проверки', () => {
  beforeEach(() => { vi.mocked(confirm).mockReset(); });

  it('главный ответ экрана виден утверждением, а не примечанием', () => {
    setup();
    expect(screen.getByText('Все проверки действуют')).toBeInTheDocument();
  });

  it('снятие спрашивает подтверждение и называет последствие', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const { createBypass } = setup();

    fireEvent.change(screen.getByLabelText('Где'), { target: { value: 'ALL' } });
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'баг в приёмке' } });
    fireEvent.click(screen.getByRole('button', { name: /Снять проверку/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const opts = vi.mocked(confirm).mock.calls[0][0];
    expect(opts.variant).toBe('danger');
    // Последствие, а не название механики; область названа до нажатия
    expect(opts.message).toMatch(/Цех сможет взять задание/);
    expect(opts.message).toMatch(/ВСЕЙ СИСТЕМЕ/);
    await waitFor(() => expect(createBypass).toHaveBeenCalled());
  });

  it('отказ в диалоге ничего не снимает', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const { createBypass } = setup();

    fireEvent.change(screen.getByLabelText('Где'), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'причина' } });
    fireEvent.click(screen.getByRole('button', { name: /Снять проверку/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(createBypass).not.toHaveBeenCalled();
  });

  /**
   * Умолчание — это рекомендация, и оно не должно рекомендовать худшее.
   * Пока область не названа, действие недоступно.
   */
  it('«вся система» не стоит умолчанием, и без выбора области снять нельзя', () => {
    setup();
    const where = screen.getByLabelText('Где');
    expect(where.value).toBe('');
    expect(screen.getByRole('button', { name: /Снять проверку/ })).toBeDisabled();
  });

  it('точечное снятие уходит с id заказа, «вся система» — с null', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const { createBypass } = setup();

    fireEvent.change(screen.getByLabelText('Где'), { target: { value: 'o1' } });
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'причина' } });
    fireEvent.click(screen.getByRole('button', { name: /Снять проверку/ }));
    await waitFor(() => expect(createBypass).toHaveBeenCalledWith('material_gate', 'o1', 'причина'));
  });
});
