import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import {
  launchCheck, setPayment, transitionFailureKind, transitionOrder, transitionOrderDetailed, TRANSITION_TARGETS, SERVER_OUTDATED_TEXT,
} from './salesTransitions';

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

  it('transitionOrder шлёт p_expected_updated_at только при значении', async () => {
    rpc.mockResolvedValue({ data: { id: 'o-1', status: 'ready_to_launch', erp_order_id: null, updated_at: 'u2' }, error: null });
    await transitionOrder('o-1', 'ready_to_launch', undefined, 'u1');
    expect(rpc).toHaveBeenLastCalledWith('order_v4_transition', {
      p_id: 'o-1', p_to: 'ready_to_launch', p_reason: null, p_expected_updated_at: 'u1',
    });
    await transitionOrder('o-1', 'ready_to_launch', undefined, null);
    expect(rpc).toHaveBeenLastCalledWith('order_v4_transition', { p_id: 'o-1', p_to: 'ready_to_launch', p_reason: null });
    await transitionOrder('o-1', 'ready_to_launch', undefined, '');
    expect(rpc).toHaveBeenLastCalledWith('order_v4_transition', { p_id: 'o-1', p_to: 'ready_to_launch', p_reason: null });
  });

  it('erpOrderId уходит как p_erp_order_id; ответ с updated_at и sent_at', async () => {
    const row = { id: 'o-1', status: 'production', erp_order_id: 'e-1', updated_at: 'u3', sent_at: 's' };
    rpc.mockResolvedValueOnce({ data: row, error: null });
    expect(await transitionOrder('o-1', 'production', undefined, undefined, 'e-1')).toEqual(row);
    expect(rpc).toHaveBeenCalledWith('order_v4_transition', {
      p_id: 'o-1', p_to: 'production', p_reason: null, p_erp_order_id: 'e-1',
    });
  });

  it('PGRST202 (нет функции с такими аргументами) — «Вышло обновление сервера» и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.order_v4_transition(p_expected_updated_at, p_id, p_reason, p_to) in the schema cache' },
    });
    expect(await transitionOrder('o-1', 'ready_to_launch', undefined, 'u1')).toBeNull();
    expect(err).toHaveBeenCalledWith(SERVER_OUTDATED_TEXT);
    expect(SERVER_OUTDATED_TEXT).toBe('Вышло обновление сервера — обновите страницу');
  });

  it('404 на функцию оплаты и проверки — тот же текст', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: '404', message: 'Not Found' }, status: 404 });
    expect(await setPayment('o-1', 'full')).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find' } });
    expect(await launchCheck('o-1')).toBeNull();
    expect(err.mock.calls.map((c) => c[0])).toEqual([SERVER_OUTDATED_TEXT, SERVER_OUTDATED_TEXT]);
  });

  it('launchCheck: ответ формы J — launched и updated_at', async () => {
    const r = { ok: true, already: false, launched: false, launch_started_at: 't', updated_at: 'u' };
    rpc.mockResolvedValueOnce({ data: r, error: null });
    expect(await launchCheck('o-2')).toEqual(r);
  });

  it('setPayment: ответ J с updated_at и status', async () => {
    const row = { id: 'o-3', paid_at: 't', paid_kind: 'prepaid', paid_override_reason: null, updated_at: 'u', status: 'ready_to_launch' };
    rpc.mockResolvedValueOnce({ data: row, error: null });
    expect(await setPayment('o-3', 'prepaid')).toEqual(row);
  });

  it('transitionFailureKind: «изменён в другой вкладке» — conflict, прочее — other', () => {
    expect(transitionFailureKind('Заказ изменён в другой вкладке — обновите страницу')).toBe('conflict');
    expect(transitionFailureKind('Сформируйте ТЗ — PDF позиции не найден в хранилище')).toBe('other');
    expect(transitionFailureKind(null)).toBe('other');
    expect(transitionFailureKind(undefined)).toBe('other');
  });

  it('transitionOrderDetailed: отказ — тост, data = null и тот же текст в message', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Заказ изменён в другой вкладке — обновите страницу', code: 'P0001' } });
    const r = await transitionOrderDetailed('o-1', 'ready_to_launch', undefined, 'v2');
    expect(rpc).toHaveBeenCalledWith('order_v4_transition', {
      p_id: 'o-1', p_to: 'ready_to_launch', p_reason: null, p_expected_updated_at: 'v2',
    });
    expect(r).toEqual({ data: null, message: 'Заказ изменён в другой вкладке — обновите страницу' });
    expect(transitionFailureKind(r.message)).toBe('conflict');
    expect(err).toHaveBeenCalledWith('Заказ изменён в другой вкладке — обновите страницу');
  });

  it('transitionOrderDetailed: успех — ответ и пустой message', async () => {
    const row = { id: 'o-1', status: 'ready_to_launch', erp_order_id: null, updated_at: 'v3', sent_at: 's' };
    rpc.mockResolvedValueOnce({ data: row, error: null });
    expect(await transitionOrderDetailed('o-1', 'ready_to_launch', undefined, 'v2')).toEqual({ data: row, message: '' });
  });

  it('transitionOrderDetailed: отказ сети — текст с причиной, без исключения', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await transitionOrderDetailed('o-1', 'ready_to_launch');
    expect(r.data).toBeNull();
    expect(r.message).toMatch(/^Не удалось сменить статус заказа: /);
  });
});
