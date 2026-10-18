import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { useAuthStore } from '../../store/useAuthStore';
import { __resetSalesStoreForTests } from '../store/useSalesStore';

/**
 * «К запуску» (К22): гейты, сводка в `aria-describedby`, `aria-disabled` без
 * оплаты, фокус после запуска, возврата и ошибки. Сеть и мост замоканы:
 * сам запуск сторожит `bridge/launch.test.ts`.
 */
const api = vi.hoisted(() => ({ fetchSalesOrder: vi.fn(), fetchSalesOrders: vi.fn() }));
vi.mock('../api/salesOrders', async (orig) => ({ ...(await orig()), ...api }));
const rpc = vi.hoisted(() => ({ transitionOrder: vi.fn(), setPayment: vi.fn(), launchCheck: vi.fn() }));
vi.mock('../api/salesTransitions', async (orig) => ({ ...(await orig()), ...rpc }));
vi.mock('../api/salesEvents', () => ({ lastOverride: vi.fn().mockResolvedValue(null), lastReturn: vi.fn().mockResolvedValue(null) }));
const bridge = vi.hoisted(() => ({ launchToErp: vi.fn() }));
vi.mock('../bridge/launch', async (orig) => ({ ...(await orig()), launchToErp: bridge.launchToErp }));
const tz = vi.hoisted(() => ({ checkTzHashes: vi.fn() }));
vi.mock('../bridge/tzCheck', async (orig) => ({ ...(await orig()), checkTzHashes: tz.checkTzHashes }));
vi.mock('../tz/tzCatalogs', () => ({ useTzCatalogs: () => ({ catalogs: CATALOGS, failed: false }) }));
vi.mock('../api/artworks', async (orig) => ({ ...(await orig()), artworkSignedUrl: vi.fn().mockResolvedValue(null), artworkDownloadUrl: vi.fn() }));
const nav = vi.hoisted(() => ({ switchToProduction: vi.fn() }));
vi.mock('../switchToProduction', () => nav);
const dlg = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../store/useConfirmStore', () => dlg);

const CATALOGS = vi.hoisted(() => ({
  fabricsCatalog: [], extrasCatalog: [], labelLibrary: null, packOptions: [], zonesCatalog: [],
  garmentFlats: null, suppliers: [], tzSettings: null,
}));

const { default: LaunchScreen } = await import('./LaunchScreen');

const live = { active: true, approved: true };
const MS = { id: 'u-ms', role: 'manager', is_ms: true, ...live };
const SELLER = { id: 'u-seller', role: 'manager', is_sales: true, ...live };

const ORDER_ID = 'o-1';
const order = (patch = {}) => newSalesOrder({
  id: ORDER_ID, number: 'PH-1', status: 'ready_to_launch', created_by: 'u-seller', updated_at: 'v1',
  paid_kind: 'full', paid_at: '2026-10-18T07:00:00Z', due_date: '2026-11-30', customer: 'Ромашка',
  items: [newSalesItem({ product_type: 'Худи', size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] } })],
  ...patch,
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function renderScreen(user, o = order()) {
  useAuthStore.setState({ user });
  api.fetchSalesOrder.mockResolvedValue(o);
  return render(
    <MemoryRouter initialEntries={[`/sales/${ORDER_ID}/launch`]}>
      <Routes>
        <Route path="/sales/:id/launch" element={<LaunchScreen />} />
        <Route path="/sales/:id" element={<Where />} />
        <Route path="/sales" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const launchBtn = () => screen.getByRole('button', { name: 'Запустить в производство' });

beforeEach(() => {
  __resetSalesStoreForTests();
  api.fetchSalesOrder.mockReset();
  api.fetchSalesOrders.mockReset().mockResolvedValue([]);
  rpc.transitionOrder.mockReset();
  bridge.launchToErp.mockReset();
  tz.checkTzHashes.mockReset().mockResolvedValue({ ok: true });
  nav.switchToProduction.mockReset();
  dlg.confirm.mockReset();
});

describe('LaunchScreen', () => {
  it('не МС и не руководство производства — в карточку заказа', async () => {
    renderScreen(SELLER);
    expect(await screen.findByTestId('where')).toHaveTextContent(`/sales/${ORDER_ID}`);
  });

  it('МС: обе кнопки, сводка запуска — в aria-describedby «Запустить»', async () => {
    renderScreen(MS);
    await waitFor(() => expect(launchBtn()).not.toHaveAttribute('aria-disabled'));
    expect(screen.getByRole('button', { name: 'Вернуть менеджеру' })).toBeInTheDocument();
    const ids = launchBtn().getAttribute('aria-describedby').split(' ');
    expect(document.getElementById(ids[0])).toHaveTextContent(/^Будет создан заказ в производстве: 1 позиция, 10 шт\., запуск/);
  });

  it('без оплаты — aria-disabled с причиной, кнопка в Tab-порядке; клик ведёт фокус к оплате, запуска нет', async () => {
    renderScreen(MS, order({ paid_kind: null, paid_at: null }));
    const btn = await screen.findByRole('button', { name: 'Запустить в производство' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/Нет отметки оплаты — отметьте оплату или попросите руководителя/);
    fireEvent.click(btn);
    expect(bridge.launchToErp).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Оплата' }));
  });

  it('ТЗ разошлось с данными — предупреждение и запуск закрыт', async () => {
    const reason = 'ТЗ не соответствует текущим данным заказа или справочникам — верните менеджеру, он отправит заново';
    tz.checkTzHashes.mockResolvedValue({ ok: false, reason });
    renderScreen(MS);
    expect(await screen.findByRole('status')).toHaveTextContent(reason);
    expect(launchBtn()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(launchBtn());
    expect(bridge.launchToErp).not.toHaveBeenCalled();
  });

  it('запуск прошёл — итог «Заказ запущен в производство» с фокусом, дата и справочники — в запуск', async () => {
    bridge.launchToErp.mockResolvedValue({ ok: true, erpOrderId: 'erp-1', alreadyLaunched: false, warnings: ['«Худи»: проверьте маршрут'] });
    renderScreen(MS);
    await waitFor(() => expect(launchBtn()).not.toHaveAttribute('aria-disabled'));
    fireEvent.change(screen.getByLabelText('Дата запуска'), { target: { value: '2026-10-27' } });
    fireEvent.click(launchBtn());
    const head = await screen.findByRole('heading', { name: 'Заказ запущен в производство' });
    await waitFor(() => expect(document.activeElement).toBe(head));
    expect(screen.getByText('«Худи»: проверьте маршрут')).toBeInTheDocument();
    expect(bridge.launchToErp).toHaveBeenCalledWith(expect.objectContaining({ id: ORDER_ID }),
      expect.objectContaining({ launchDate: '2026-10-27', catalogs: CATALOGS, actor: 'u-ms' }));
  });

  it('отказ запуска — текст ошибки role=alert с фокусом', async () => {
    bridge.launchToErp.mockResolvedValue({ ok: false, stage: 'files', reason: 'Файл с таким именем уже есть в производстве — повторите запуск' });
    renderScreen(MS);
    await waitFor(() => expect(launchBtn()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(launchBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('уже есть в производстве');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('возврат: причина обязательна, ошибка RPC — внутри окна, причина не теряется; успех — итог с фокусом', async () => {
    rpc.transitionOrder.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: ORDER_ID, status: 'draft', erp_order_id: null, updated_at: 'v2', sent_at: null });
    renderScreen(MS);
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть менеджеру' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Вернуть с причиной' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Что исправить менеджеру'), { target: { value: 'Нет макета на спине' } });
    fireEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Заказ не возвращён');
    expect(within(dialog).getByLabelText('Что исправить менеджеру')).toHaveValue('Нет макета на спине');
    fireEvent.click(submit);
    const head = await screen.findByRole('heading', { name: 'Заказ возвращён менеджеру' });
    await waitFor(() => expect(document.activeElement).toBe(head));
    expect(rpc.transitionOrder).toHaveBeenLastCalledWith(ORDER_ID, 'draft', 'Нет макета на спине');
  });

  it('отмена возврата — фокус на «Вернуть менеджеру»', async () => {
    renderScreen(MS);
    const back = await screen.findByRole('button', { name: 'Вернуть менеджеру' });
    fireEvent.click(back);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(back);
  });

  it('заказ уже запущен — итог со ссылкой в производство и «Отметить: заказ сдан»', async () => {
    renderScreen(MS, order({ status: 'production', erp_order_id: 'erp-7' }));
    expect(await screen.findByRole('heading', { name: 'Заказ уже запущен' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть заказ в производстве' }));
    expect(nav.switchToProduction).toHaveBeenCalledWith('/orders/erp-7');
    expect(screen.getByRole('button', { name: 'Отметить: заказ сдан' })).toBeInTheDocument();
  });

  it('«Следующий к запуску» — следующий по сроку, без текущего', async () => {
    api.fetchSalesOrders.mockResolvedValue([
      { id: 'n-late', status: 'ready_to_launch', due_date: '2026-12-01', updated_at: 'x' },
      { id: ORDER_ID, status: 'ready_to_launch', due_date: '2026-10-01', updated_at: 'x' },
      { id: 'n-soon', status: 'ready_to_launch', due_date: '2026-11-01', updated_at: 'x' },
    ]);
    renderScreen(MS, order({ status: 'draft' }));
    const next = await screen.findByRole('button', { name: 'Следующий к запуску (осталось 2)' });
    fireEvent.click(next);
    await waitFor(() => expect(api.fetchSalesOrder).toHaveBeenLastCalledWith('n-soon'));
  });
});
