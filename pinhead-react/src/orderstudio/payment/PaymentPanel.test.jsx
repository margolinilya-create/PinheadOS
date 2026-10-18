import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentPanel from './PaymentPanel';
import { OVERRIDE_MAX, paymentStatusText } from './paymentText';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { newSalesOrder } from '../model/factory';

/**
 * Оплата (К16): кнопки действий без автосмены (стрелки и Tab не шлют RPC),
 * у МС — подтверждение и нет «Снять отметку», у руководства — причина
 * «без оплаты» до 500 знаков; в чтении — кто и почему разрешил.
 */
const rpc = vi.hoisted(() => ({ setPayment: vi.fn() }));
vi.mock('../api/salesTransitions', () => rpc);
const ev = vi.hoisted(() => ({ lastOverride: vi.fn() }));
vi.mock('../api/salesEvents', () => ev);
const dlg = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../store/useConfirmStore', () => dlg);

const live = { active: true, approved: true };
const SELLER = { id: 'u-seller', role: 'production', is_sales: true, ...live };
const MS = { id: 'u-ms', role: 'manager', is_ms: true, ...live };
const ROP = { id: 'u-rop', role: 'rop', ...live };

const order = (patch = {}) => newSalesOrder({
  id: 'o-1', status: 'draft', created_by: 'u-seller', updated_at: 'v1', ...patch,
});

beforeEach(() => {
  __resetSalesStoreForTests();
  rpc.setPayment.mockReset();
  ev.lastOverride.mockReset().mockResolvedValue(null);
  dlg.confirm.mockReset();
});

const okAnswer = (patch = {}) => ({
  id: 'o-1', paid_at: '2026-10-18T07:00:00Z', paid_kind: 'prepaid', paid_override_reason: null,
  updated_at: 'v2', status: 'draft', ...patch,
});

describe('PaymentPanel', () => {
  it('статус текстом: не отмечена / предоплата с датой по Москве / полностью', () => {
    expect(paymentStatusText(order())).toBe('Оплата: не отмечена');
    expect(paymentStatusText(order({ paid_kind: 'prepaid', paid_at: '2026-10-17T22:30:00Z' }))).toBe('Предоплата получена 18.10');
    expect(paymentStatusText(order({ paid_kind: 'full', paid_at: '2026-10-18T07:00:00Z' }))).toBe('Оплачен полностью 18.10');
  });

  it('стрелки и Tab на кнопках не вызывают setPayment (не радиогруппа); вызов — только нажатием', async () => {
    rpc.setPayment.mockResolvedValue(okAnswer());
    render(<PaymentPanel order={order()} user={SELLER} />);
    const btn = screen.getByRole('button', { name: 'Отметить предоплату' });
    // Кнопки — нативные <button>: Enter и пробел нажимают их сами браузером
    expect(btn.tagName).toBe('BUTTON');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    btn.focus();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab', 'Home', 'End']) {
      fireEvent.keyDown(btn, { key });
      fireEvent.keyUp(btn, { key });
    }
    expect(rpc.setPayment).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(rpc.setPayment).toHaveBeenCalledWith('o-1', 'prepaid', undefined));
  });

  it('продавец: клик → RPC → applyServer кладёт оплату и версию; фокус на заголовке', async () => {
    rpc.setPayment.mockResolvedValue(okAnswer());
    const o = order();
    useSalesStore.setState({ current: o, saveState: 'clean' });
    render(<PaymentPanel order={o} user={SELLER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить предоплату' }));
    await waitFor(() => expect(useSalesStore.getState().current?.paid_kind).toBe('prepaid'));
    expect(useSalesStore.getState().current?.updated_at).toBe('v2');
    expect(screen.getByRole('heading', { name: 'Оплата' })).toHaveFocus();
    expect(dlg.confirm).not.toHaveBeenCalled();
  });

  it('у продавца нет «Снять отметку» и «без оплаты»', () => {
    render(<PaymentPanel order={order({ paid_kind: 'prepaid', paid_at: 't' })} user={SELLER} />);
    expect(screen.queryByRole('button', { name: 'Снять отметку' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Разрешить запуск без оплаты' })).toBeNull();
  });

  it('МС на «К запуску»: подтверждение перед RPC; отказ в диалоге — RPC нет; нет «Снять отметку»', async () => {
    const o = order({ status: 'ready_to_launch', paid_kind: 'prepaid', paid_at: 't' });
    dlg.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    rpc.setPayment.mockResolvedValue(okAnswer({ paid_kind: 'full', status: 'ready_to_launch' }));
    render(<PaymentPanel order={o} user={MS} />);
    expect(screen.queryByRole('button', { name: 'Снять отметку' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Разрешить запуск без оплаты' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отметить полную оплату' }));
    expect(dlg.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Отметить полную оплату?', message: 'Снять отметку сможет только руководитель',
    }));
    expect(rpc.setPayment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отметить полную оплату' }));
    await waitFor(() => expect(rpc.setPayment).toHaveBeenCalledWith('o-1', 'full', undefined));
  });

  it('МС в черновике и на своём заказе — только статус, без кнопок', () => {
    const { unmount } = render(<PaymentPanel order={order()} user={MS} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    unmount();
    render(<PaymentPanel order={order({ status: 'ready_to_launch', created_by: 'u-ms' })} user={MS} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('руководство: «без оплаты» — причина обязательна, до 500 знаков, уходит в RPC', async () => {
    rpc.setPayment.mockResolvedValue(okAnswer({ paid_kind: null, paid_at: null, paid_override_reason: 'постоянный клиент' }));
    render(<PaymentPanel order={order({ status: 'ready_to_launch' })} user={ROP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить запуск без оплаты' }));
    const box = screen.getByLabelText('Почему запускаем без оплаты');
    expect(box).toHaveAttribute('maxLength', String(OVERRIDE_MAX));
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить запуск без оплаты' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите причину');
    expect(rpc.setPayment).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'постоянный клиент' } });
    expect(screen.getByText(`17 / ${OVERRIDE_MAX}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить запуск без оплаты' }));
    await waitFor(() => expect(rpc.setPayment).toHaveBeenCalledWith('o-1', null, 'постоянный клиент'));
  });

  it('руководство: «Снять отметку» шлёт null без причины', async () => {
    rpc.setPayment.mockResolvedValue(okAnswer({ paid_kind: null, paid_at: null }));
    render(<PaymentPanel order={order({ paid_kind: 'full', paid_at: 't' })} user={ROP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять отметку' }));
    await waitFor(() => expect(rpc.setPayment).toHaveBeenCalledWith('o-1', null, undefined));
  });

  it('в чтении — кто, когда и почему разрешил запуск без оплаты', async () => {
    ev.lastOverride.mockResolvedValue({ reason: 'постоянный клиент', actorName: 'Ольга РОП', at: '2026-10-18T07:00:00Z' });
    render(<PaymentPanel order={order({ status: 'production', paid_override_reason: 'постоянный клиент' })} user={MS} />);
    expect(await screen.findByText('Запуск без оплаты разрешил(а) Ольга РОП 18.10: «постоянный клиент»')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ошибка RPC — текст ошибки с фокусом, оплата не меняется', async () => {
    rpc.setPayment.mockResolvedValue(null);
    const o = order();
    useSalesStore.setState({ current: o, saveState: 'clean' });
    render(<PaymentPanel order={o} user={SELLER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить предоплату' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(useSalesStore.getState().current?.paid_kind).toBeNull();
  });
});
