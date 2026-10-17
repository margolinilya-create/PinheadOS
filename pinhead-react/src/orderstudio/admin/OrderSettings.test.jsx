import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { confirm } from '../../store/useConfirmStore';
import { useAuthStore } from '../../store/useAuthStore';
import { setCatalogUnsaved } from '../leaveGuard';
import OrderSettings from './OrderSettings';
import { ORDER_SETTINGS_TABS, tabFromSearch } from './orderSettingsTabs';
import CatalogNotice from './CatalogNotice';
import { catalogConflictText as conflictText, CATALOG_FALLBACK_TEXT as FALLBACK_TEXT } from './useCatalogEditor';

vi.mock('../../store/useConfirmStore', async (orig) => ({ ...(await orig()), confirm: vi.fn() }));

function renderAt(path, role = 'admin') {
  useAuthStore.setState({ user: { id: 'u-1', role, active: true, approved: true } });
  const router = createMemoryRouter(
    [
      { path: '/order-settings', element: <OrderSettings /> },
      { path: '/sku', element: <h1>Каталог моделей</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const tab = (name) => screen.getByRole('tab', { name });
const tabParam = (router) => new URLSearchParams(router.state.location.search).get('tab');

function mockCompact(matches) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

beforeEach(() => vi.mocked(confirm).mockReset());
afterEach(() => {
  setCatalogUnsaved('test', false);
  delete window.matchMedia;
});

describe('OrderSettings — вкладки в адресе', () => {
  it('реестр: пять вкладок в порядке плана', () => {
    expect(ORDER_SETTINGS_TABS.map((t) => t.id)).toEqual(['suppliers', 'labels', 'packaging', 'pricing', 'tz']);
    expect(tabFromSearch('tz')).toBe('tz');
    expect(tabFromSearch('nope')).toBe('suppliers');
    expect(tabFromSearch(null)).toBe('suppliers');
  });

  it('вкладка из ?tab= выбрана, панель связана с ней', () => {
    renderAt('/order-settings?tab=labels');
    expect(screen.getByRole('heading', { name: 'Справочники заказа' })).toBeInTheDocument();
    expect(tab('Бирки и схемы')).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab('Бирки и схемы').id);
    expect(panel).toHaveTextContent('«Бирки и схемы»');
  });

  it('неизвестная вкладка — первая', () => {
    renderAt('/order-settings?tab=hack');
    expect(tab('Поставщики и палитры')).toHaveAttribute('aria-selected', 'true');
  });

  it('клик по вкладке пишет её в адрес', async () => {
    const router = renderAt('/order-settings');
    fireEvent.click(tab('Подвал ТЗ'));
    await waitFor(() => expect(tabParam(router)).toBe('tz'));
    expect(tab('Подвал ТЗ')).toHaveAttribute('aria-selected', 'true');
  });

  it('клавиатура: стрелки и End переключают вкладку, Tab проходит набор одной остановкой', async () => {
    const router = renderAt('/order-settings?tab=suppliers');
    const first = tab('Поставщики и палитры');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(tab('Упаковка')).toHaveAttribute('tabindex', '-1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => expect(tabParam(router)).toBe('labels'));
    expect(document.activeElement).toBe(tab('Бирки и схемы'));
    fireEvent.keyDown(tab('Бирки и схемы'), { key: 'End' });
    await waitFor(() => expect(tabParam(router)).toBe('tz'));
  });
});

describe('OrderSettings — несохранённый справочник', () => {
  it('смена вкладки переспрашивает; «Остаться» — вкладка прежняя', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const router = renderAt('/order-settings?tab=suppliers');
    setCatalogUnsaved('test', true);
    await act(async () => { fireEvent.click(tab('Упаковка')); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ confirmLabel: 'Перейти без сохранения' });
    expect(tabParam(router)).toBe('suppliers');
  });

  it('согласие — вкладка сменилась', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const router = renderAt('/order-settings?tab=suppliers');
    setCatalogUnsaved('test', true);
    await act(async () => { fireEvent.click(tab('Упаковка')); });
    await waitFor(() => expect(tabParam(router)).toBe('packaging'));
  });

  it('без правок — без вопроса', async () => {
    const router = renderAt('/order-settings');
    fireEvent.click(tab('Правила цены'));
    await waitFor(() => expect(tabParam(router)).toBe('pricing'));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('OrderSettings — шапка и телефон', () => {
  it('admin: ссылка на «Каталог моделей и цен»', () => {
    renderAt('/order-settings', 'admin');
    expect(screen.getByRole('link', { name: '«Каталоге моделей и цен»' })).toHaveAttribute('href', '/sku');
  });

  it('rop: каталог моделей не открыт — текст без ссылки', () => {
    renderAt('/order-settings', 'rop');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Ткани и цены моделей — в «Каталоге моделей и цен»/)).toBeInTheDocument();
  });

  it('≤ 760 px: вкладка только для просмотра и пояснение', () => {
    mockCompact(true);
    renderAt('/order-settings');
    expect(screen.getByRole('note')).toHaveTextContent('только для просмотра');
    expect(screen.getByRole('tabpanel').querySelector('[data-readonly="true"]')).not.toBeNull();
  });

  it('компьютер: правка открыта', () => {
    mockCompact(false);
    renderAt('/order-settings');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('tabpanel').querySelector('[data-readonly]')).toBeNull();
  });
});

describe('CatalogNotice — состояния редактора', () => {
  const editor = (state) => ({ state, reload: vi.fn() });

  it('конфликт: alert с именем справочника и «Загрузить свежую версию»', () => {
    const e = editor('conflict');
    render(<CatalogNotice editor={e} name="Поставщики и палитры" />);
    expect(screen.getByRole('alert')).toHaveTextContent(conflictText('Поставщики и палитры'));
    expect(conflictText('Поставщики и палитры')).toBe(
      'Справочник «Поставщики и палитры» уже изменили — в другой вкладке или другой администратор. Ваши правки не сохранены. Загрузите свежую версию и внесите их снова.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить свежую версию' }));
    expect(e.reload).toHaveBeenCalled();
  });

  it('не загрузилось: встроенные значения и «Загрузить снова»', () => {
    const e = editor('fallback');
    render(<CatalogNotice editor={e} name="Подвал ТЗ" />);
    expect(screen.getByText(FALLBACK_TEXT)).toBeInTheDocument();
    expect(FALLBACK_TEXT).toBe('Справочник не загрузился. Заказы пока считают по встроенным значениям.');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить снова' }));
    expect(e.reload).toHaveBeenCalled();
  });

  it('готов — ничего не показывает', () => {
    const { container } = render(<CatalogNotice editor={editor('ready')} name="X" />);
    expect(container).toBeEmptyDOMElement();
  });
});
