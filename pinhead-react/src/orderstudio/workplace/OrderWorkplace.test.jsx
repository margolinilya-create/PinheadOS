import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import OrderWorkplace from './OrderWorkplace';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { useStore } from '../../store/useStore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';
import { isEditable } from '../model/editable';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import * as api from '../api/salesOrders';
import { supabase } from '../../lib/supabase';
import * as confirmStore from '../../store/useConfirmStore';

vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig()),
  fetchSalesOrder: vi.fn(),
  saveSalesOrder: vi.fn(),
}));

/** Любая цепочка запроса Supabase: ответ пустой, вызовы `from` считаются */
vi.mock('../../lib/supabase', () => {
  const chain = () => new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then'
      ? (res) => Promise.resolve({ data: null, error: null }).then(res)
      : () => chain()),
    apply: () => chain(),
  });
  return { supabase: { from: vi.fn(() => chain()), rpc: vi.fn(() => chain()) } };
});

/**
 * Вкладка «Дизайн» — заглушка: холст (konva, справочник флэтов) проверяет
 * `design/ui/DesignTab.test.jsx`, здесь — встройка: ленивый вход, пропсы, адрес
 */
vi.mock('../design/ui/DesignTab', () => ({
  default: function DesignTabStub({ item, readOnly, compact, onOpenItem }) {
    return (
      <div data-testid="design-tab" data-design-canvas="">
        {`позиция ${item.key}; только чтение: ${readOnly}; узко: ${compact}`}
        <button type="button" onClick={onOpenItem}>Открыть нанесения</button>
      </div>
    );
  },
}));

/**
 * Справочники ТЗ (веха 6+7): без сети — образцы фикстур. Иначе справочник
 * флэтов читал бы `app_config`, и сторож «не пишет в app_config» (он считает
 * обращения к таблице) путал бы чтение с записью
 */
vi.mock('../tz/tzCatalogs', async () => {
  const { fixtureCatalogs } = await import('../fixtures/loadFixture.testutil');
  const catalogs = fixtureCatalogs();
  return { useTzCatalogs: () => ({ catalogs, failed: false }) };
});

const SKU = SKU_CATALOG_DEFAULT[2];
/**
 * Каталог моделей урезан: каждая строка `SkuList` считает цену «от …»,
 * и полный каталог с палитрой давал секунды на рендер — под нагрузкой полного
 * прогона тесты упирались в таймаут. Таймаут файла поднят по той же причине.
 */
const SMALL_SKU_CATALOG = SKU_CATALOG_DEFAULT.slice(0, 6);
vi.setConfig({ testTimeout: 30000 });
const FABRIC = 'cotton-kulirnaya-100-180';

const itemA = (over = {}) => newSalesItem({
  sku_code: SKU.code,
  product_type: SKU.name,
  fit: SKU.fit || 'regular',
  fabric_code: FABRIC,
  size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10, M: 5 } }] },
  ...over,
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}

/** Рабочее место с уже открытым заказом (`open` того же id ничего не читает) */
function renderWp(order, search = '') {
  vi.mocked(api.fetchSalesOrder).mockResolvedValue(order);
  useSalesStore.setState({
    current: order,
    currentLoading: false,
    saveState: isEditable(order) ? 'clean' : 'locked',
  });
  return render(
    <MemoryRouter initialEntries={[`/sales/${order.id}${search}`]}>
      <Routes>
        <Route path="/sales/:id" element={<><OrderWorkplace /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Рабочее место через настоящее открытие: заказ читается с «сервера» */
function renderFetched(order) {
  vi.mocked(api.fetchSalesOrder).mockResolvedValue(order);
  return render(
    <MemoryRouter initialEntries={[`/sales/${order.id}`]}>
      <Routes><Route path="/sales/:id" element={<OrderWorkplace />} /></Routes>
    </MemoryRouter>,
  );
}

const current = () => useSalesStore.getState().current;
const swatches = (root = document) => [...root.querySelectorAll('.swatch')];
/** Образец цвета, которого нет у позиции: код из подписи «Имя (код)» */
function otherSwatch() {
  const el = swatches().find((s) => s.getAttribute('aria-pressed') === 'false');
  const code = /\(([^)]+)\)$/.exec(el.getAttribute('aria-label'))[1];
  return { el, code };
}

beforeEach(() => {
  __resetSalesStoreForTests();
  useStore.getState().resetItemFields();
  useStore.setState({ skuCatalog: SMALL_SKU_CATALOG });
  vi.mocked(api.saveSalesOrder).mockReset();
  vi.mocked(api.saveSalesOrder).mockResolvedValue({
    ok: true, saved: { id: 'o-1', order_number: 'PH-0042', updated_at: '2026-10-17T10:00:00Z' },
  });
  vi.mocked(api.fetchSalesOrder).mockReset();
  vi.mocked(supabase.from).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OrderWorkplace — вкладка «Изделие»', () => {
  it('выбор цвета пишет в сетку выбранной позиции, вторую не трогает', async () => {
    const a = itemA();
    const b = itemA({ size_grid: { sizes: ['S'], rows: [{ color: 'Белый (01-01)', sizes: { S: 7 } }] } });
    renderWp(newSalesOrder({ id: 'o-1', items: [a, b] }), `?tab=item&item=${b.key}`);
    const { el, code } = otherSwatch();
    fireEvent.click(el);
    const [na, nb] = current().items;
    expect(nb.size_grid.rows[0].color).toContain(code);
    expect(nb.size_grid.rows[0].sizes).toEqual({ S: 7 });
    expect(na).toBe(a);
  });

  it('переход на позицию B: правка уходит в B, позиция A остаётся прежней', async () => {
    const a = itemA();
    const b = itemA({ size_grid: { sizes: ['S'], rows: [{ color: 'Белый (01-01)', sizes: { S: 3 } }] } });
    renderWp(newSalesOrder({ id: 'o-1', items: [a, b] }), `?item=${a.key}`);
    const list = screen.getByRole('list', { name: 'Изделия заказа' });
    const buttons = within(list).getAllByRole('button', { name: /шт$/ });
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`item=${b.key}`));
    const { el, code } = otherSwatch();
    fireEvent.click(el);
    expect(current().items[0]).toBe(a);
    expect(current().items[1].size_grid.rows[0].color).toContain(code);
  });

  it('правка на «Изделии» сохраняется с ценой заказа', async () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    fireEvent.click(otherSwatch().el);
    await act(() => useSalesStore.getState().flush());
    expect(api.saveSalesOrder).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.saveSalesOrder).mock.calls[0][0];
    expect(payload.price_total).toEqual(expect.any(Number));
    expect(payload.price_total).not.toBeNull();
  });

  it('многоцветная позиция — плашка «разнесите по цветам» вместо панелей', () => {
    const multi = itemA({
      size_grid: { sizes: ['S'], rows: [{ color: 'Белый', sizes: { S: 1 } }, { color: 'Чёрный', sizes: { S: 2 } }] },
    });
    renderWp(newSalesOrder({ id: 'o-1', items: [multi] }));
    expect(screen.getByText(/В позиции 2 цвета — разнесите по цветам, чтобы править изделие/)).toBeInTheDocument();
    expect(swatches()).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Разнести по цветам/ }).length).toBeGreaterThan(0);
  });

  it('разнесение с плашки спрашивает и делает две позиции', async () => {
    const multi = itemA({
      size_grid: { sizes: ['S'], rows: [{ color: 'Белый', sizes: { S: 1 } }, { color: 'Чёрный', sizes: { S: 2 } }] },
    });
    renderWp(newSalesOrder({ id: 'o-1', items: [multi] }));
    const ask = vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    const panel = screen.getByRole('tabpanel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Разнести по цветам' }));
    await waitFor(() => expect(current().items).toHaveLength(2));
    expect(ask).toHaveBeenCalled();
  });

  it('пустой заказ — «Добавить изделие», и только кнопка создаёт позицию', () => {
    renderWp(newSalesOrder({ id: 'o-1' }));
    expect(current().items).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить изделие' }));
    expect(current().items).toHaveLength(1);
    expect(screen.getByTestId('location').textContent).toContain(`item=${current().items[0].key}`);
  });

  it('ткань клиента: флажок пишет позицию и прячет выбор ткани', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    expect(document.querySelector('.fabric-section')).not.toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ткань клиента (в цену не входит)' }));
    expect(current().items[0].client_fabric).toBe(true);
    expect(document.querySelector('.fabric-section')).toBeNull();
  });

  it('кнопки «−» и «+» размеров названы по размеру, цены в таблице размеров нет', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    // Запросы по роли на полном каталоге моделей и палитре — секунды; по подписи — мгновенно
    expect(screen.getAllByLabelText('Уменьшить M').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText('Увеличить M')[0]);
    expect(current().items[0].size_grid.rows[0].sizes.M).toBe(6);
    expect(screen.queryByText('Цена/шт')).toBeNull();
  });

  it('«Далее: клиент и доставка» открывает вкладку клиента', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    fireEvent.click(screen.getByText('Далее: клиент и доставка'));
    expect(screen.getByRole('tab', { name: /^Клиент/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location').textContent).toContain('tab=client');
    // Сюда пришли кнопкой «Далее» — фокус в первом поле формы
    expect(document.activeElement).toBe(screen.getByLabelText('Клиент'));
  });
});

describe('OrderWorkplace — вкладки', () => {
  it('?tab=client открывает клиента; стрелки, Home и End переключают', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }), '?tab=client');
    const client = screen.getByRole('tab', { name: /^Клиент/ });
    expect(client).toHaveAttribute('aria-selected', 'true');
    expect(client).toHaveAttribute('tabindex', '0');
    const panel = screen.getByRole('tabpanel');
    expect(client.getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getByLabelText('Клиент')).toBeInTheDocument();

    client.focus();
    fireEvent.keyDown(client, { key: 'ArrowRight' });
    const summary = screen.getByRole('tab', { name: /^ТЗ и цена/ });
    expect(summary).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(summary);
    expect(screen.getByTestId('location').textContent).toContain('tab=summary');

    fireEvent.keyDown(summary, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /^Изделие/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(summary).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(screen.getByRole('tab', { name: /^Изделие/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(summary).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Изделие/ })).toHaveAttribute('tabindex', '-1');
  });

  it('стрелкой на «Клиент» фокус остаётся на вкладке, а не уходит в поле', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    const item = screen.getByRole('tab', { name: /^Изделие/ });
    item.focus();
    fireEvent.keyDown(item, { key: 'Home' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /^Дизайн/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    const client = screen.getByRole('tab', { name: /^Клиент/ });
    expect(client).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Клиент')).toBeInTheDocument();
    expect(document.activeElement).toBe(client);
    // следующая стрелка снова переключает вкладку
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /^ТЗ и цена/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('клик по вкладке «Клиент» не переносит фокус в поле', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    const client = screen.getByRole('tab', { name: /^Клиент/ });
    client.focus();
    fireEvent.click(client);
    expect(document.activeElement).not.toBe(screen.getByLabelText('Клиент'));
  });

  it('маркеры готовности: изделие готово, клиент не заполнен', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    expect(screen.getByRole('tab', { name: 'Изделие — готово' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Клиент — не заполнено' })).toBeInTheDocument();
  });

  /**
   * 375 px (веха 8, задача 5): у каждого маркера есть точка-значок для глаза
   * (`aria-hidden`, видна на ≤ 480 px), текст остаётся в имени вкладки;
   * «готово» — иконкой, без глифа ✓
   */
  it('маркеры: точка-значок aria-hidden, текст в имени, «готово» — иконкой', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    const dot = screen.getByTestId('tab-mark-client');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.textContent).toBe('');
    const item = screen.getByRole('tab', { name: 'Изделие — готово' });
    expect(item.textContent).not.toContain('✓');
    expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('tab-mark-item')).toBeNull();
  });

  it('менеджер на вкладке клиента — только чтение', () => {
    renderWp(newSalesOrder({ id: 'o-1', manager: 'Анна' }), '?tab=client');
    const manager = screen.getByLabelText('Менеджер');
    expect(manager).toHaveAttribute('readonly');
    expect(manager).toHaveValue('Анна');
  });
});

describe('OrderWorkplace — вкладка «Дизайн» (веха 5а)', () => {
  const layout = { v: 1, flat_id: 'tshirt-test', flat_version: 1, view: 'front', area_id: 'chest', x_mm: 240, y_mm: 167, rotation_deg: 0, flip_h: false, flip_v: false,
    asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false } };

  it('?tab=design: холст лениво, позиции выпадающим списком; открытие ничего не пишет', async () => {
    const a = itemA();
    const b = itemA();
    renderWp(newSalesOrder({ id: 'o-1', items: [a, b] }), `?tab=design&item=${b.key}`);
    expect(screen.getByRole('tab', { name: /^Дизайн/ })).toHaveAttribute('aria-selected', 'true');
    const stub = await screen.findByTestId('design-tab');
    expect(stub.textContent).toContain(`позиция ${b.key}; только чтение: false; узко: false`);
    expect(screen.queryByRole('list', { name: 'Изделия заказа' })).toBeNull();
    expect(current().items[0]).toBe(a);
    expect(current().items[1]).toBe(b);
    expect(useSalesStore.getState().saveState).toBe('clean');
  });

  it('маркер вкладки: «— не размещено N», когда строки без холста', () => {
    const a = itemA({ flat_id: 'tshirt-test', prints: [newSalesPrint({ zone: 'Грудь', layout }), newSalesPrint({ zone: 'Рукав' })] });
    renderWp(newSalesOrder({ id: 'o-1', items: [a] }));
    expect(screen.getByRole('tab', { name: 'Дизайн — не размещено: 1' })).toBeInTheDocument();
    // На ≤ 480 px глазу — бейдж с числом, без слов (aria-hidden)
    const badge = screen.getByTestId('tab-mark-design');
    expect(badge.textContent).toBe('1');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('все нанесения на холсте — «готово»; нанесений нет — без маркера', () => {
    const a = itemA({ flat_id: 'tshirt-test', prints: [newSalesPrint({ zone: 'Грудь', layout })] });
    const { unmount } = renderWp(newSalesOrder({ id: 'o-1', items: [a] }));
    expect(screen.getByRole('tab', { name: 'Дизайн — готово' })).toBeInTheDocument();
    unmount();
    renderWp(newSalesOrder({ id: 'o-2', items: [itemA()] }));
    expect(screen.getByRole('tab', { name: 'Дизайн' })).toBeInTheDocument();
  });

  it('«Изделие»: строка на холсте — мм только чтение, «Изменить на холсте» ведёт на ?tab=design', async () => {
    const a = itemA({ flat_id: 'tshirt-test', prints: [newSalesPrint({ zone: 'Грудь', width_mm: 120, height_mm: 80, layout })] });
    renderWp(newSalesOrder({ id: 'o-1', items: [a] }), `?tab=item&item=${a.key}`);
    // Первое «Ширина, мм» — у нанесения (второе — упаковка позиции)
    expect(screen.getAllByLabelText('Ширина, мм')[0]).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить на холсте' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('tab=design'));
    expect(screen.getByTestId('location').textContent).toContain(`item=${a.key}`);
    await screen.findByTestId('design-tab');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть нанесения' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('tab=item'));
  });

  it('заказ не черновик — холст только для чтения', async () => {
    renderWp(newSalesOrder({ id: 'o-1', status: 'production', items: [itemA()] }), '?tab=design');
    expect((await screen.findByTestId('design-tab')).textContent).toContain('только чтение: true');
  });
});

describe('OrderWorkplace — «ТЗ и цена»', () => {
  it('итог заказа и пометка «нужна ручная цена» ссылкой на позицию', () => {
    const bad = itemA({ sku_code: 'NOPE', product_type: 'Нечто' });
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA(), bad] }), '?tab=summary');
    expect(screen.getByTestId('order-total').textContent).toMatch(/₽/);
    const link = screen.getByRole('link', { name: /нужна ручная цена/ });
    expect(link.getAttribute('href')).toContain(`item=${bad.key}`);
    expect(link.getAttribute('href')).toContain('tab=item');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('OrderWorkplace — сохранение и только чтение', () => {
  it('заказ в производстве: панели только для чтения, текст по статусу', () => {
    renderWp(newSalesOrder({ id: 'o-1', status: 'production', items: [itemA()] }));
    expect(screen.getByRole('status')).toHaveTextContent('В производстве — только просмотр');
    const all = swatches();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.getAttribute('aria-disabled') === 'true')).toBe(true);
    const before = current();
    fireEvent.click(all.find((s) => s.getAttribute('aria-pressed') === 'false'));
    expect(current()).toBe(before);
    expect(screen.queryByText('+ Изделие')).toBeNull();
    expect(screen.getAllByLabelText('Увеличить M')[0]).toBeDisabled();
  });

  it.each([
    ['ready_to_launch', 'Отправлен в работу — правка закрыта'],
    ['done', 'Готов — только просмотр'],
    ['archived', 'В архиве — только просмотр'],
  ])('статус %s — «%s»', (status, text) => {
    renderWp(newSalesOrder({ id: 'o-1', status, items: [itemA()] }));
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('вышло обновление — текст и кнопка «Обновить страницу»', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    act(() => useSalesStore.setState({ saveState: 'outdated' }));
    expect(screen.getByRole('status')).toHaveTextContent('Вышло обновление — обновите страницу, последняя правка не сохранена');
    expect(screen.getByText('Обновить страницу').tagName).toBe('BUTTON');
  });

  it.each([
    ['clean', 'Сохранено'],
    ['saving', 'Сохраняю…'],
    ['error', 'Не сохранено — повторим при следующей правке'],
    ['conflict', 'Заказ изменён в другой вкладке — обновите страницу'],
  ])('состояние %s — «%s»', (state, text) => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    act(() => useSalesStore.setState({ saveState: state }));
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it.each([
    ['черновик', newSalesOrder({ id: 'o-1', items: [itemA()] })],
    ['пустой черновик', newSalesOrder({ id: 'o-1' })],
    ['в производстве', newSalesOrder({ id: 'o-1', status: 'production', items: [itemA()] })],
    ['многоцветный', newSalesOrder({
      id: 'o-1',
      items: [itemA({ size_grid: { sizes: ['S'], rows: [{ color: 'A', sizes: { S: 1 } }, { color: 'B', sizes: { S: 1 } }] } })],
    })],
    ['модель не из каталога', newSalesOrder({ id: 'o-1', items: [itemA({ sku_code: 'NOPE', product_type: 'Своё' })] })],
  ])('открытие заказа (%s) не зовёт сохранение', async (_name, order) => {
    const { unmount } = renderFetched(order);
    await waitFor(() => expect(current()?.id).toBe('o-1'));
    await screen.findByRole('tablist');
    unmount();
    await act(() => useSalesStore.getState().flush());
    expect(api.saveSalesOrder).not.toHaveBeenCalled();
  });

  it('рабочее место не пишет в app_config (перетаскивание моделей выключено)', async () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    const rows = [...document.querySelectorAll('.garment-row')];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.getAttribute('draggable') !== 'true')).toBe(true);
    fireEvent.drop(rows[1], { dataTransfer: { dropEffect: 'move' } });
    fireEvent.click(otherSwatch().el);
    await act(() => useSalesStore.getState().flush());
    const tables = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('app_config');
  });
});

describe('OrderWorkplace — перенесено из карточки заказа', () => {
  const priced = () => itemA({
    size_grid: { sizes: ['S'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10 } }] },
    manual_unit_price: 1000,
  });

  it('скидка в рублях: вид выбирают при пустой сумме — он не слетает на «%»', () => {
    renderWp(newSalesOrder({ id: 'o-1', items: [priced()] }), '?tab=summary');
    fireEvent.change(screen.getByLabelText('Вид скидки'), { target: { value: 'sum' } });
    const amount = screen.getByLabelText('Размер скидки');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '1000' } });
    expect(current().discount).toEqual({ mode: 'sum', value: 1000 });
    expect(screen.getByTestId('order-total').textContent).toBe(`${(9000).toLocaleString('ru-RU')} ₽`);
  });

  it('скидка в процентах не больше 100', () => {
    renderWp(newSalesOrder({ id: 'o-1' }), '?tab=client');
    const amount = screen.getByLabelText('Размер скидки');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '150' } });
    expect(current().discount).toEqual({ mode: 'pct', value: 100 });
  });

  it('ручная цена позиции пишется по ключу позиции', () => {
    const a = itemA();
    const b = itemA();
    renderWp(newSalesOrder({ id: 'o-1', items: [a, b] }), `?item=${b.key}`);
    fireEvent.change(screen.getByLabelText('Ручная цена за штуку'), { target: { value: '1000' } });
    expect(current().items[1].manual_unit_price).toBe(1000);
    expect(current().items[0]).toBe(a);
  });

  it('уход с рабочего места сразу после правки не затирает цену в базе', async () => {
    const { unmount } = renderWp(newSalesOrder({ id: 'o-1', items: [itemA()] }));
    fireEvent.click(screen.getAllByLabelText('Увеличить S')[0]);
    unmount();
    await waitFor(() => expect(api.saveSalesOrder).toHaveBeenCalled());
    const payload = vi.mocked(api.saveSalesOrder).mock.calls.at(-1)[0];
    expect(payload.price_total).toEqual(expect.any(Number));
    expect(payload.items[0].price_unit).toEqual(expect.any(Number));
  });
});

describe('OrderWorkplace — компактная раскладка', () => {
  it('≤ 760: позиции — выпадающий список, рядом действия и «+ Изделие»', () => {
    // В jsdom нет matchMedia — подставляем на время теста (снимает afterEach)
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q.includes('760'), media: q, addEventListener() {}, removeEventListener() {},
    }));
    const a = itemA();
    const b = itemA({ size_grid: { sizes: ['S'], rows: [{ color: 'Чёрный', sizes: { S: 1 } }] } });
    renderWp(newSalesOrder({ id: 'o-1', items: [a, b] }));
    const select = screen.getByRole('combobox', { name: 'Изделие' });
    fireEvent.change(select, { target: { value: b.key } });
    expect(screen.getByTestId('location').textContent).toContain(`item=${b.key}`);
    expect(screen.getByLabelText(/^Действия с изделием/).tagName).toBe('BUTTON');
    expect(screen.getByText('+ Изделие').tagName).toBe('BUTTON');
  });
});
