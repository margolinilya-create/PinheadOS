import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { launchCheck, setPayment, transitionOrder, TRANSITION_TARGETS } from './salesTransitions';

/**
 * Действия заказа v4 — только RPC миграции 20261017062110_order_v4_rights:
 * переход статуса, проверка запуска, отметка оплаты. Ошибка Supabase —
 * `toast.error` с русским текстом и `null` (правило проекта).
 */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('salesTransitions', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.restoreAllMocks();
  });

  it('transitionOrder зовёт order_v4_transition с причиной', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-1', status: 'draft', erp_order_id: null }, error: null });
    const r = await transitionOrder('o-1', 'draft', 'нет размеров');
    expect(rpc).toHaveBeenCalledWith('order_v4_transition', { p_id: 'o-1', p_to: 'draft', p_reason: 'нет размеров' });
    expect(r).toEqual({ id: 'o-1', status: 'draft', erp_order_id: null });
  });

  it('transitionOrder без причины шлёт p_reason = null', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-1', status: 'ready_to_launch', erp_order_id: null }, error: null });
    await transitionOrder('o-1', 'ready_to_launch');
    expect(rpc).toHaveBeenCalledWith('order_v4_transition', { p_id: 'o-1', p_to: 'ready_to_launch', p_reason: null });
  });

  it('цели перехода — ровно белый список RPC', () => {
    expect([...TRANSITION_TARGETS].sort()).toEqual(['archived', 'done', 'draft', 'production', 'ready_to_launch']);
  });

  it('ошибка перехода — toast.error с текстом сервера и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // данные рядом с ошибкой не принимаются за успех
    rpc.mockResolvedValueOnce({ data: { id: 'junk' }, error: { message: 'Нет отметки оплаты', code: 'P0001' } });
    expect(await transitionOrder('o-1', 'production')).toBeNull();
    expect(err).toHaveBeenCalledWith('Нет отметки оплаты');
  });

  it('launchCheck: ответ { ok: false, reason } — не ошибка, без тоста', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'Нет отметки оплаты' }, error: null });
    const r = await launchCheck('o-2');
    expect(rpc).toHaveBeenCalledWith('order_v4_launch_check', { p_id: 'o-2' });
    expect(r).toEqual({ ok: false, reason: 'Нет отметки оплаты' });
    expect(err).not.toHaveBeenCalled();
  });

  it('launchCheck: уже запущен', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, already: true, erp_order_id: 'e-1' }, error: null });
    expect(await launchCheck('o-2')).toEqual({ ok: true, already: true, erp_order_id: 'e-1' });
  });

  it('launchCheck: ошибка Supabase — toast и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Заказ не найден или недоступен', code: '42501' } });
    expect(await launchCheck('o-2')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('setPayment: вид и причина руководителя', async () => {
    const row = { id: 'o-3', paid_at: null, paid_kind: null, paid_override_reason: 'постоянный клиент' };
    rpc.mockResolvedValueOnce({ data: row, error: null });
    expect(await setPayment('o-3', null, 'постоянный клиент')).toEqual(row);
    expect(rpc).toHaveBeenCalledWith('order_v4_set_payment', {
      p_id: 'o-3', p_kind: null, p_override_reason: 'постоянный клиент',
    });
  });

  it('setPayment без причины шлёт p_override_reason = null', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'o-3', paid_at: 't', paid_kind: 'full', paid_override_reason: null }, error: null });
    await setPayment('o-3', 'full');
    expect(rpc).toHaveBeenCalledWith('order_v4_set_payment', { p_id: 'o-3', p_kind: 'full', p_override_reason: null });
  });

  it('setPayment: ошибка — toast и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Запуск без оплаты разрешает только руководитель' } });
    expect(await setPayment('o-3', null, 'x')).toBeNull();
    expect(err).toHaveBeenCalledWith('Запуск без оплаты разрешает только руководитель');
  });

  it('отказ сети (rpc бросает) — toast и null, а не необработанное исключение', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await transitionOrder('o-1', 'done')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });
});
