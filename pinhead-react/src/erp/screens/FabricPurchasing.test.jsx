import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import FabricPurchasing from './FabricPurchasing';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ТРИ СОСТОЯНИЯ ЭКРАНА ЗАКУПКИ.
 *
 * ЗАЧЕМ ЭТОТ СТОРОЖ. До 03.09 `LoadFailed` и `TableSkeleton` физически лежали
 * ВНУТРИ `<PurchaseCard>`, то есть под условием `loaded && selectedOrder`.
 * Отступ у них был сброшен к левому краю — строки выглядели верхнеуровневыми,
 * и комментарий рядом уверял, что правило UX-2 соблюдено. В тексте оно и было
 * соблюдено; в дереве `loadError && !loaded` внутри блока, требующего
 * `loaded`, недостижимо по построению.
 *
 * Цена: закупщик по цеховому Wi-Fi видел один заголовок «Закупка» — и пока
 * идёт запрос, и НАВСЕГДА при его отказе, потому что `if (!loaded) loadAll()`
 * второй раз не срабатывает, а кнопки «Повторить» на экране не существовало.
 *
 * Проверка идёт по ЭКРАНУ, а не по исходнику: перенеси кто-нибудь состояния
 * обратно внутрь карточки — тест краснеет, как бы ни выглядели отступы.
 */

const loadAll = vi.fn(async () => true);

function setStore(patch) {
  useErpStore.setState({
    departments: [{ id: 'd-sup', code: 'supply', name: 'Закупка', active: true, is_production: false }],
    orders: [],
    loaded: true,
    loadError: false,
    loadAll,
    ...patch,
  });
}

const renderScreen = () => render(
  <MemoryRouter><FabricPurchasing /></MemoryRouter>,
);

describe('Закупка — состояния экрана', () => {
  beforeEach(() => { loadAll.mockClear(); });

  it('сбой загрузки: «Не удалось загрузить» и кнопка «Повторить»', () => {
    setStore({ loaded: false, loadError: true });
    renderScreen();
    expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
  });

  it('загрузка: скелетон, а не пустая страница', () => {
    setStore({ loaded: false, loadError: false });
    renderScreen();
    expect(screen.getByLabelText('Загрузка закупки')).toBeInTheDocument();
  });

  it('при сбое скелетон не показывается — иначе экран «грузится» вечно', () => {
    setStore({ loaded: false, loadError: true });
    renderScreen();
    expect(screen.queryByLabelText('Загрузка закупки')).not.toBeInTheDocument();
  });

  /**
   * Ровно тот случай, который ломался: заказ не выбран (а выбрать нечего —
   * данных нет). Прежняя разметка не показывала в этом состоянии НИЧЕГО.
   */
  it('состояния видны и без выбранного заказа', () => {
    setStore({ loaded: false, loadError: true, orders: [] });
    renderScreen();
    expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
  });

  it('загруженный экран не показывает ни ошибку, ни скелетон', () => {
    setStore({ loaded: true, loadError: false });
    renderScreen();
    expect(screen.queryByText(/Не удалось загрузить/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Загрузка закупки')).not.toBeInTheDocument();
  });
});

/**
 * КАРТОЧКА ЗАКУПКИ — ШИРОКОЙ ПАНЕЛЬЮ, КОНТЕКСТ — В АДРЕСЕ (правка 05.10, п. 6).
 *
 * «Карточка закупки открывается под общим списком заказов, до неё
 * приходится скроллить… Открывать закупку отдельной карточкой или в широкой
 * области. Материалы и действия видны сразу. При возврате сохранять поиск,
 * фильтры и место в списке… Убрать горизонтальный скролл».
 */
describe('Закупка — карточка в широкой панели', () => {
  const stage = (id, status = 'in_progress') => ({ id, department_id: 'd-sup', status, depends_on: [] });
  const order = (id, bitrix, materials) => ({
    id, bitrix_id: bitrix, title: `Заказ ${bitrix}`, status: 'active', due_date: '2026-10-20',
    items: [{ id: `${id}-i`, stages: [stage(`${id}-s`)] }],
    materials, attachments: [], warehouse_tasks: [],
  });
  const mat = (id, name, patch = {}) => ({
    id, name, kind: 'fabric', source: 'purchase', status: 'pending', unit: 'кг',
    qty_expected: 100, qty_ordered: 110, qty_received: null, suppliers: [],
    created_at: '2026-10-01T09:00:00Z', ...patch,
  });
  const ORDERS = [
    order('o1', '5001', [mat('m1', 'Кулирка'), mat('m2', 'Футер', { status: 'in_transit' })]),
    order('o2', '5002', [mat('m3', 'Рибана')]),
  ];

  /** Текущий адрес — его пишет эффект, а не рендер (правило react-hooks) */
  const where = { loc: null };
  function Spy() {
    const l = useLocation();
    useEffect(() => { where.loc = l; });
    return null;
  }
  const renderAt = (url) => render(
    <MemoryRouter initialEntries={[url]}><FabricPurchasing /><Spy /></MemoryRouter>,
  );
  const sp = () => new URLSearchParams(where.loc.search);

  beforeEach(() => {
    setStore({ orders: ORDERS, loadMaterialReceipts: vi.fn(async () => []) });
  });

  it('без выбора панели нет — виден список заказов', () => {
    renderAt('/purchasing');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: /Заказы в закупке/ })).toBeInTheDocument();
  });

  it('«Открыть» открывает широкую панель с материалами и действиями сразу', () => {
    renderAt('/purchasing');
    const rows = screen.getAllByRole('row').filter((r) => r.textContent.includes('Заказ 5001'));
    fireEvent.click(within(rows[0]).getByRole('button', { name: /^Открыть/ }));
    expect(sp().get('supply')).toBe('o1');
    const dialog = screen.getByRole('dialog', { name: 'Карточка закупки' });
    expect(dialog.className).toMatch(/drawerPanelWide/);
    expect(within(dialog).getByText('Кулирка')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '+ Материал' })).toBeInTheDocument();
    // Сводка строкой, без плиток
    expect(within(dialog).getByText(/^Материалов 2/)).toBeInTheDocument();
  });

  it('таблица материалов без горизонтальной прокрутки, статус и действие в строке', () => {
    renderAt('/purchasing?supply=o1');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('region', { name: /Закупка материалов/ })).toBeNull();
    const heads = within(dialog).getAllByRole('columnheader').map((th) => th.textContent);
    for (const h of ['Материал и цвет', 'Поставщик', 'Количество', 'Цена', 'Срок прихода', 'Статус', 'Действие']) {
      expect(heads.some((t) => t.includes(h)), h).toBe(true);
    }
    // Артикул и прочее — в подробностях, а не колонкой
    expect(heads.some((t) => t.includes('Артикул'))).toBe(false);
    expect(within(dialog).getByLabelText('Статус Кулирка')).toBeInTheDocument();
  });

  it('поиск, фильтр и страница — в адресе; закрытие возвращает к списку', () => {
    renderAt('/purchasing?supply=o1');
    fireEvent.change(screen.getByLabelText('Поиск по закупке'), { target: { value: 'кул' } });
    expect(sp().get('q')).toBe('кул');
    expect(screen.queryByText('Футер')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(sp().get('supply')).toBeNull();
    expect(sp().get('q')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('возврат по адресу восстанавливает поиск и фильтр карточки', () => {
    renderAt('/purchasing?supply=o1&status=transit');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Футер')).toBeInTheDocument();
    expect(within(dialog).queryByText('Кулирка')).toBeNull();
    expect(within(dialog).getByText(/Фильтр: В пути/)).toBeInTheDocument();
  });

  it('«+ Материал» открывает форму с уже выбранным заказом', () => {
    renderAt('/purchasing?supply=o2');
    fireEvent.click(screen.getByRole('button', { name: '+ Материал' }));
    expect(screen.getByLabelText('Заказ')).toHaveValue('o2');
  });

  it('единственный заказ открывается сам, но после закрытия не возвращается', () => {
    setStore({ orders: [ORDERS[0]], loadMaterialReceipts: vi.fn(async () => []) });
    renderAt('/purchasing');
    expect(sp().get('supply')).toBe('o1');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(sp().get('supply')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * «Отметка закупщика о прибытии не увеличивает остаток» (правка 05.10,
   * п. 7). Закупщик пишет только статус; принятое ведёт журнал приёмок,
   * а «Пришло» и «Частично» в его селекте погашены.
   */
  it('смена статуса закупщиком пишет только статус, не количество', () => {
    const updateMaterial = vi.fn(async () => true);
    setStore({ orders: ORDERS, updateMaterial, loadMaterialReceipts: vi.fn(async () => []) });
    renderAt('/purchasing?supply=o1');
    const select = screen.getByLabelText('Статус Кулирка');
    expect(within(select).getByRole('option', { name: /^Пришло/ })).toBeDisabled();
    expect(within(select).getByRole('option', { name: /^Частично/ })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'in_transit' } });
    expect(updateMaterial).toHaveBeenCalledWith('m1', { status: 'in_transit' });
  });
});
