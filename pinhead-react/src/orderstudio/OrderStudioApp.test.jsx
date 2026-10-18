import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { switchToProduction } from './switchToProduction';
import { useAuthStore } from '../store/useAuthStore';
import { setCatalogUnsaved } from './leaveGuard';

vi.mock('./switchToProduction', () => ({ switchToProduction: vi.fn() }));
vi.mock('../lib/catalogs', () => ({
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
  // Вкладки «Справочников заказа» читают справочник свежим запросом (веха 4)
  fetchCatalogKey: vi.fn().mockResolvedValue({ exists: false, value: null }),
  clearCatalogsCache: vi.fn(),
}));
vi.mock('./api/salesOrders', async (orig) => ({
  ...(await orig()),
  fetchSalesOrders: vi.fn().mockResolvedValue([]),
  fetchSalesOrder: vi.fn().mockResolvedValue(null),
}));

// Старт раздела стирает черновик визарда v3: кладём его ДО импорта модуля
localStorage.setItem('pinhead_draft', '{"step":2,"name":"Ромашка"}');
const { default: OrderStudioApp } = await import('./OrderStudioApp');
const { useSalesStore } = await import('./store/useSalesStore');

const prof = (role, is_sales = false) => ({ id: 'u-1', name: 'Тест', email: 't@pinhead.ru', role, is_sales, active: true, approved: true });

function renderApp(user, path = '/') {
  // В приложении профиль один и тот же в сторе авторизации и в пропсе оболочки
  useAuthStore.setState({ user });
  const router = createMemoryRouter(
    [{ path: '*', element: <OrderStudioApp user={user} /> }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => vi.mocked(switchToProduction).mockClear());

describe('OrderStudioApp — старт раздела', () => {
  it('черновик визарда v3 (pinhead_draft) удалён при загрузке раздела', () => {
    expect(localStorage.getItem('pinhead_draft')).toBeNull();
  });
});

describe('OrderStudioApp — доступ по ролям', () => {
  it('/ ведёт в список заказов', async () => {
    const router = renderApp(prof('admin'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
    expect(await screen.findByRole('heading', { name: 'Все заказы' })).toBeInTheDocument();
    expect(switchToProduction).not.toHaveBeenCalled();
  });

  it('продавец попадает в «Мои заказы»', async () => {
    const router = renderApp(prof('manager', true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
    expect(await screen.findByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument();
  });

  it.each([
    ['production', '/'],
    ['designer', '/sales'],
    ['manager', '/sku'],
  ])('%s без признака продавца на %s — переключение в «Производство», без петли', async (role, path) => {
    const router = renderApp(prof(role), path);
    await waitFor(() => expect(switchToProduction).toHaveBeenCalledTimes(1));
    // Маршруты раздела не смонтированы: редиректов нет, адрес не прыгает
    expect(router.state.location.pathname).toBe(path);
    expect(screen.queryByRole('navigation', { name: 'Разделы заказа' })).toBeNull();
  });

  it('продавец на /sku (только admin/director) — в список, а не в «Производство»', async () => {
    const router = renderApp(prof('manager', true), '/sku');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
    expect(switchToProduction).not.toHaveBeenCalled();
  });

  it('МС без признака продавца входит в раздел: «Заказы в работе», без «Нового заказа»', async () => {
    const router = renderApp({ ...prof('manager'), is_ms: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
    expect(await screen.findByRole('heading', { name: 'Заказы в работе' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Новый заказ' })).toBeNull();
    expect(switchToProduction).not.toHaveBeenCalled();
  });

  it('rop открывает «Сотрудников продаж»', async () => {
    const router = renderApp(prof('rop'), '/sales-staff');
    expect(await screen.findByRole('heading', { name: 'Сотрудники продаж' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sales-staff');
  });

  it.each([
    ['продавец', prof('manager', true)],
    ['МС', { ...prof('manager'), is_ms: true }],
  ])('%s на /sales-staff — в список заказов', async (_who, user) => {
    const router = renderApp(user, '/sales-staff');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
  });

  it.each(['rop', 'director'])('%s открывает «Справочники заказа»', async (role) => {
    const router = renderApp(prof(role), '/order-settings?tab=tz');
    expect(await screen.findByRole('heading', { name: 'Справочники заказа' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Подвал ТЗ' })).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.pathname).toBe('/order-settings');
  });

  it.each([
    ['продавец', prof('manager', true)],
    ['МС', { ...prof('manager'), is_ms: true }],
  ])('%s на /order-settings — в список заказов', async (_who, user) => {
    const router = renderApp(user, '/order-settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
    expect(screen.queryByRole('link', { name: 'Справочники заказа' })).toBeNull();
  });

  it('старый мастер позиции /sales/:id/item/:key больше не открывается', async () => {
    const router = renderApp(prof('admin'), '/sales/o-1/item/new');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
  });
});

describe('OrderStudioApp — диалог ухода с карточки v4', () => {
  /** Карточка открыта, сохранение в состоянии saveState; уход в список */
  async function leaveWith(saveState) {
    const router = renderApp(prof('admin'), '/sales/o-1');
    await waitFor(() => expect(useSalesStore.getState().currentLoading).toBe(false));
    act(() => useSalesStore.setState({ saveState }));
    act(() => { void router.navigate('/sales'); });
    const dialog = await screen.findByRole('dialog', { name: 'Правки заказа не сохранены' });
    return { router, dialog };
  }

  it.each(['outdated', 'conflict'])('%s — уход остановлен, текст «скопируйте и обновите»', async (saveState) => {
    const { router, dialog } = await leaveWith(saveState);
    expect(dialog).toHaveTextContent('Правка не сохранена — скопируйте изменения и обновите страницу. Уйти без сохранения?');
    expect(router.state.location.pathname).toBe('/sales/o-1');
    fireEvent.click(screen.getByRole('button', { name: 'Остаться' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/sales/o-1');
  });

  it('error — прежний текст про сбой сохранения', async () => {
    const { dialog } = await leaveWith('error');
    expect(dialog).toHaveTextContent('Последнее сохранение не удалось.');
    expect(dialog).not.toHaveTextContent('скопируйте изменения');
  });
});

describe('OrderStudioApp — уход с несохранённым справочником', () => {
  afterEach(() => setCatalogUnsaved('test', false));

  it('уход со страницы — свой диалог; «Уйти без сохранения» уводит', async () => {
    const router = renderApp(prof('rop'), '/order-settings');
    await screen.findByRole('heading', { name: 'Справочники заказа' });
    setCatalogUnsaved('test', true);
    act(() => { void router.navigate('/sales'); });
    const dialog = await screen.findByRole('dialog', { name: 'Правки справочника не сохранены' });
    expect(dialog).toHaveTextContent('Если уйти, они пропадут.');
    expect(router.state.location.pathname).toBe('/order-settings');
    fireEvent.click(screen.getByRole('button', { name: 'Уйти без сохранения' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
  });

  it('смена ?tab= роутером не блокируется (её спрашивает экран)', async () => {
    const router = renderApp(prof('rop'), '/order-settings');
    await screen.findByRole('heading', { name: 'Справочники заказа' });
    setCatalogUnsaved('test', true);
    act(() => { void router.navigate('/order-settings?tab=labels'); });
    await waitFor(() => expect(router.state.location.search).toBe('?tab=labels'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OrderStudioApp — «К запуску» /sales/:id/launch (веха 6+7)', () => {
  it('продавцу экран запуска закрыт — карточка заказа', async () => {
    const router = renderApp(prof('manager', true), '/sales/o-1/launch');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/o-1'));
  });

  it('rop (не МС) — тоже в карточку: запуск — сторона производства', async () => {
    const router = renderApp(prof('rop'), '/sales/o-1/launch');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/o-1'));
  });

  it.each([
    ['admin', prof('admin')],
    ['МС', { ...prof('manager'), is_ms: true }],
  ])('%s открывает ленивый экран запуска', async (_name, user) => {
    const router = renderApp(user, '/sales/o-1/launch');
    // Первый ленивый чанк экрана в jsdom грузится дольше секунды по умолчанию
    expect(await screen.findByText('Заказ не найден или недоступен', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sales/o-1/launch');
  });
});
