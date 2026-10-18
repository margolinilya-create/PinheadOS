import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import OrderWorkplace from './OrderWorkplace';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { useAuthStore } from '../../store/useAuthStore';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { isEditable } from '../model/editable';

/**
 * Рабочее место, веха 6+7 (задача 5): шапка — бейдж оплаты, «Отправить в работу»
 * (только навигация к `#send`), «Отметить: заказ сдан» у `canFinish`; плашки
 * «отправлен» и «вернули»; на время отправки — `fieldset disabled`.
 */
vi.mock('../api/salesOrders', async (orig) => ({ ...(await orig()), fetchSalesOrder: vi.fn(), saveSalesOrder: vi.fn() }));
vi.mock('../../lib/supabase', () => {
  const chain = () => new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then' ? (res) => Promise.resolve({ data: null, error: null }).then(res) : () => chain()),
    apply: () => chain(),
  });
  return { supabase: { from: vi.fn(() => chain()), rpc: vi.fn(() => chain()) } };
});
vi.mock('../design/ui/DesignTab', () => ({ default: () => <div data-testid="design-tab" /> }));
vi.mock('../tz/tzCatalogs', async () => {
  const { fixtureCatalogs } = await import('../fixtures/loadFixture.testutil');
  const catalogs = fixtureCatalogs();
  return { useTzCatalogs: () => ({ catalogs, failed: false }) };
});
const tr = vi.hoisted(() => ({ transitionOrder: vi.fn() }));
vi.mock('../api/salesTransitions', async (orig) => ({ ...(await orig()), ...tr }));
const ev = vi.hoisted(() => ({ lastReturn: vi.fn(), lastOverride: vi.fn() }));
vi.mock('../api/salesEvents', () => ev);
const dlg = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../store/useConfirmStore', async (orig) => ({ ...(await orig()), ...dlg }));

const live = { active: true, approved: true };
const SELLER = { id: 'u-seller', role: 'manager', is_sales: true, ...live };
const MS = { id: 'u-ms', role: 'manager', is_ms: true, ...live };
const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

const item = () => newSalesItem({
  key: 'a', sku_code: 'TEE', product_type: 'Футболка', fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] },
});
const order = (patch = {}) => newSalesOrder({
  id: ID, number: 'PH-0042', customer: '', due_date: '', created_by: 'u-seller', updated_at: 'v1', items: [item()], ...patch,
});

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}{loc.hash}</div>;
}

/** Вкладка по умолчанию — «Клиент»: «Изделие» рисует каталог моделей и медленна в jsdom */
function renderWp(o, user = SELLER, search = '?tab=client') {
  useAuthStore.setState({ user });
  useSalesStore.setState({ current: o, currentLoading: false, saveState: isEditable(o) ? 'clean' : 'locked' });
  return render(
    <MemoryRouter initialEntries={[`/sales/${o.id}${search}`]}>
      <Routes><Route path="/sales/:id" element={<><OrderWorkplace /><Probe /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetSalesStoreForTests();
  tr.transitionOrder.mockReset();
  ev.lastReturn.mockReset().mockResolvedValue(null);
  ev.lastOverride.mockReset().mockResolvedValue(null);
  dlg.confirm.mockReset();
});
afterEach(() => { useAuthStore.setState({ user: null }); });

describe('OrderWorkplace — шапка отправки и оплаты', () => {
  it('«Отправить в работу · 2 пункта» ведёт на ?tab=summary#send и фокусирует заголовок раздела', async () => {
    renderWp(order(), SELLER, '?tab=client&item=a');
    expect(screen.getByText('Оплата: не отмечена')).toBeInTheDocument();
    // Модель чек-листа — ленивый чанк: число пунктов появляется, когда он приехал
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить в работу · 2 пункта' }));
    expect(screen.getByTestId('location').textContent).toBe(`/sales/${ID}?tab=summary&item=a#send`);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
    expect(document.activeElement).toHaveTextContent('Отправить в работу');
  });

  it('«Отметить: заказ сдан» — только у canFinish; после подтверждения — переход done и applyServer', async () => {
    const { unmount } = renderWp(order({ status: 'production' }), SELLER);
    expect(screen.queryByRole('button', { name: 'Отметить: заказ сдан' })).toBeNull();
    unmount();
    renderWp(order({ status: 'production' }), MS);
    dlg.confirm.mockResolvedValue(true);
    tr.transitionOrder.mockResolvedValue({ id: ID, status: 'done', erp_order_id: 'e-1', updated_at: 'v7' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отметить: заказ сдан' })); });
    expect(dlg.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Заказ PH-0042 сдан клиенту?', message: 'Вернуть статус нельзя' }));
    expect(tr.transitionOrder).toHaveBeenCalledWith(ID, 'done');
    expect(useSalesStore.getState().current?.status).toBe('done');
    expect(useSalesStore.getState().current?.updated_at).toBe('v7');
  });

  it('отказ в подтверждении — перехода нет', async () => {
    renderWp(order({ status: 'production' }), MS);
    dlg.confirm.mockResolvedValue(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отметить: заказ сдан' })); });
    expect(tr.transitionOrder).not.toHaveBeenCalled();
  });
});

describe('OrderWorkplace — плашки отправки и возврата', () => {
  it('ready_to_launch — «Отправлен на запуск 18.10 · правка закрыта…»', () => {
    renderWp(order({ status: 'ready_to_launch', sent_at: '2026-10-18T09:00:00Z' }), SELLER);
    expect(screen.getByText('Отправлен на запуск 18.10 · правка закрыта. Нужна правка — попросите МС вернуть заказ')).toBeInTheDocument();
    expect(ev.lastReturn).not.toHaveBeenCalled();
  });

  it('возврат новее отправки — плашка role=status с именем и причиной; после повторной отправки её нет', async () => {
    ev.lastReturn.mockResolvedValue({ reason: 'Нет макета на спине', actorName: 'Ольга', at: '2026-10-19T08:00:00Z' });
    renderWp(order({ sent_at: '2026-10-18T09:00:00Z' }), SELLER);
    const banner = await screen.findByText('Заказ вернул(а) Ольга 19.10: «Нет макета на спине». Исправьте и отправьте снова');
    expect(banner).toHaveAttribute('role', 'status');
    act(() => useSalesStore.getState().applyServer({ id: ID, status: 'ready_to_launch', sent_at: '2026-10-19T10:00:00Z', updated_at: 'v9' }));
    await waitFor(() => expect(screen.queryByText(/Заказ вернул\(а\)/)).toBeNull());
  });

  it('черновик без отправки — журнал не читается, плашки нет', () => {
    renderWp(order(), SELLER);
    expect(ev.lastReturn).not.toHaveBeenCalled();
    expect(screen.queryByText(/Заказ вернул\(а\)/)).toBeNull();
  });
});

describe('OrderWorkplace — отправка закрывает правку', () => {
  it('sending — поля в fieldset disabled, вкладки доступны', () => {
    renderWp(order(), SELLER, '?tab=client');
    act(() => useSalesStore.setState({ sending: true }));
    const panel = screen.getByRole('tabpanel');
    const fieldset = panel.querySelector('fieldset');
    expect(fieldset).toBeDisabled();
    expect(fieldset).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('tab', { name: /ТЗ и цена/ })).not.toBeDisabled();
    act(() => useSalesStore.setState({ sending: false }));
    expect(panel.querySelector('fieldset')).not.toBeDisabled();
  });
});
