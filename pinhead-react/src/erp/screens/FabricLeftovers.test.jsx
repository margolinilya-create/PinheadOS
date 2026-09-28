import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FabricLeftovers from './FabricLeftovers';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/** Права — управляемые тестом: вопрос здесь «кто правит место», а не матрица */
const perms = new Set();
vi.mock('../store/useErpAccess', () => ({
  useErpAccess: () => ({ can: (p) => perms.has(p) }),
}));

// Таблица, а не карточки: раскладка не предмет этого теста
vi.mock('../layout/useCompactLayout', () => ({ useCompactLayout: () => false }));

/**
 * «ОСТАТКИ ТКАНИ» ЧИТАЮТ СЕРВЕРНУЮ ВЫБОРКУ, А НЕ ЗАКАЗЫ СТОРА (правка 28.09).
 *
 * Прежний экран собирал рулоны из `orders`, и остаток сданного заказа
 * пропадал, пока не загружен архив. Сторож: экран зовёт
 * `loadFabricLeftovers`, показывает закрытый заказ со статусом и даёт
 * кладовщику записать место хранения.
 */

const leftoverRow = (extra = {}) => ({
  roll_id: 'r1', label: 'Рулон №1', seq: 1, material_id: 'm1', material: 'Кулирка чёрная',
  kind: 'fabric', unit: 'кг', order_id: 'o-closed', order_title: 'Худи для фестиваля',
  order_status: 'done_on_time', width_cm: 180, density_gsm: 240, length_m: 46.3,
  length_left_m: 10, length_source: 'measured', qty: 20, qty_left: 4.32, kg_per_m: 0.432,
  price_per_unit: 700, price_per_m: 302.4, location: null, status: 'used',
  created_at: '2026-09-20T10:00:00Z',
  ...extra,
});

let load;
let setLocation;

function setStore(patch = {}) {
  useErpStore.setState({
    orders: [],
    fabricLeftovers: null,
    loadFabricLeftovers: load,
    setRollLocation: setLocation,
    ...patch,
  });
}

const renderScreen = () => render(<MemoryRouter><FabricLeftovers /></MemoryRouter>);

describe('Остатки ткани', () => {
  beforeEach(() => {
    perms.clear();
    load = vi.fn(async () => {
      const rows = [leftoverRow()];
      useErpStore.setState({ fabricLeftovers: rows });
      return rows;
    });
    setLocation = vi.fn(async () => true);
  });

  it('грузит остатки RPC при открытии и показывает закрытый заказ со статусом', async () => {
    let finish;
    load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    setStore();
    renderScreen();
    expect(screen.getByLabelText('Загрузка остатков')).toBeInTheDocument();
    const rows = [leftoverRow()];
    useErpStore.setState({ fabricLeftovers: rows });
    finish(rows);
    expect(await screen.findByText('Кулирка чёрная')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    const link = screen.getByRole('link', { name: 'Худи для фестиваля' });
    expect(link).toHaveAttribute('href', '/orders/o-closed');
    expect(screen.getByText(/Сдан вовремя/)).toBeInTheDocument();
    expect(screen.getAllByText('10,00 м', { exact: false }).length).toBeGreaterThan(0);
  });

  it('сбой загрузки: «Повторить» перезапрашивает', async () => {
    load = vi.fn(async () => null);
    setStore();
    renderScreen();
    const retry = await screen.findByRole('button', { name: /Повторить/ });
    expect(screen.queryByLabelText('Загрузка остатков')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('пусто — объяснение, откуда берётся остаток', async () => {
    load = vi.fn(async () => { useErpStore.setState({ fabricLeftovers: [] }); return []; });
    setStore();
    renderScreen();
    expect(await screen.findByText('Остатков нет')).toBeInTheDocument();
  });

  it('без складских прав место хранения только читается', async () => {
    setStore();
    renderScreen();
    await screen.findByText('Кулирка чёрная');
    expect(screen.getByText('не указано')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить место хранения/ })).not.toBeInTheDocument();
  });

  it('кладовщик записывает место хранения через setRollLocation', async () => {
    perms.add('material.receive');
    setStore();
    renderScreen();
    await screen.findByText('Кулирка чёрная');
    fireEvent.click(screen.getByRole('button', { name: /Изменить место хранения/ }));
    const input = screen.getByLabelText(/Место хранения: Кулирка чёрная, Рулон №1/);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Стеллаж А-3 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith('r1', 'Стеллаж А-3'));
  });

  it('warehouse.manage тоже правит место; Escape отменяет без записи', async () => {
    perms.add('warehouse.manage');
    setStore();
    renderScreen();
    await screen.findByText('Кулирка чёрная');
    fireEvent.click(screen.getByRole('button', { name: /Изменить место хранения/ }));
    fireEvent.keyDown(screen.getByLabelText(/Место хранения:/), { key: 'Escape' });
    expect(screen.queryByLabelText(/Место хранения:/)).not.toBeInTheDocument();
    expect(setLocation).not.toHaveBeenCalled();
  });

  it('сброс кэша в сторе перечитывает список, а удачная загрузка — нет', async () => {
    setStore();
    renderScreen();
    await screen.findByText('Кулирка чёрная');
    expect(load).toHaveBeenCalledTimes(1);
    useErpStore.setState({ fabricLeftovers: null });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
