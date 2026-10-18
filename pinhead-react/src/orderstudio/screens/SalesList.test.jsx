import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SalesList from './SalesList';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { useAuthStore } from '../../store/useAuthStore';
import { fetchSalesOrders, findOwnEmptyDraft, saveSalesOrder } from '../api/salesOrders';

vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig()),
  fetchSalesOrders: vi.fn(),
  findOwnEmptyDraft: vi.fn(),
  saveSalesOrder: vi.fn(),
}));

const ME = 'u-me';
const ROWS = [
  { id: 'o-1', order_number: 'PH-0101', title: 'Футболки', customer: 'Ромашка', status: 'draft', price_total: 10000, due_date: '2026-11-01', updated_at: '2026-10-16T10:00:00Z', created_by: ME, manager_name: 'Анна' },
  { id: 'o-2', order_number: 'PH-0102', title: 'Худи', customer: 'Василёк', status: 'quoted', price_total: 25000, due_date: null, updated_at: '2026-10-15T10:00:00Z', created_by: 'u-other', manager_name: 'Борис' },
  { id: 'o-3', order_number: 'PH-0103', title: '', customer: 'Ромашка-2', status: 'production', price_total: 5000, due_date: null, updated_at: '2026-10-14T10:00:00Z', created_by: 'u-other', manager_name: 'Борис' },
];

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function renderList(user, path = '/sales') {
  useAuthStore.setState({ user });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales" element={<SalesList />} />
        <Route path="/sales/:id" element={<Where />} />
        <Route path="/sales/:id/launch" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ADMIN = { id: ME, role: 'admin', name: 'Илья', active: true, approved: true, is_sales: false };
const ROP = { id: ME, role: 'rop', name: 'Ольга', active: true, approved: true, is_sales: false };
const SELLER = { id: ME, role: 'manager', name: 'Анна', active: true, approved: true, is_sales: true };

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  __resetSalesStoreForTests();
  vi.mocked(fetchSalesOrders).mockReset().mockResolvedValue(ROWS.map((r) => ({ ...r })));
  vi.mocked(findOwnEmptyDraft).mockReset();
  vi.mocked(saveSalesOrder).mockReset();
});

describe('SalesList — заголовок и колонки по роли', () => {
  it('admin: «Все заказы», колонка «Менеджер», фильтр «Мои / Все»', async () => {
    renderList(ADMIN);
    expect(await screen.findByRole('heading', { name: 'Все заказы' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Менеджер' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Мои' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
    expect(bodyRows()).toHaveLength(3);
  });

  it('rop: «Заказы отдела»', async () => {
    renderList(ROP);
    expect(await screen.findByRole('heading', { name: 'Заказы отдела' })).toBeInTheDocument();
  });

  it('продавец: «Мои заказы», без колонки «Менеджер» и без фильтра «Мои / Все»', async () => {
    renderList(SELLER);
    expect(await screen.findByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Менеджер' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Мои' })).toBeNull();
  });

  it('колонки: номер, клиент, название, статус, оплата, отправлен, сумма, срок, обновлён', async () => {
    renderList(SELLER);
    await screen.findByText('PH-0101');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Номер', 'Клиент', 'Название', 'Статус', 'Оплата', 'Отправлен', 'Сумма', 'Срок', 'Обновлён']);
  });
});

describe('SalesList — фильтры', () => {
  it('поиск по клиенту', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по клиенту и номеру' }), { target: { value: 'ромашка' } });
    expect(bodyRows()).toHaveLength(2);
  });

  it('поиск по номеру — и без префикса PH', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по клиенту и номеру' }), { target: { value: '0102' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Василёк')).toBeInTheDocument();
  });

  it('фильтр статуса', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.change(screen.getByRole('combobox', { name: 'Статус' }), { target: { value: 'quoted' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('PH-0102')).toBeInTheDocument();
  });

  it('«Мои» у руководства — только заказы, заведённые мной', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }));
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('PH-0101')).toBeInTheDocument();
  });

  it('под фильтр ничего не попало — пустой результат со сбросом', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по клиенту и номеру' }), { target: { value: 'нет такого' } });
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(bodyRows()).toHaveLength(3);
  });

  it('заказов нет — пустое состояние с кнопкой «Новый заказ»', async () => {
    vi.mocked(fetchSalesOrders).mockResolvedValue([]);
    renderList(SELLER);
    expect(await screen.findByText('Заказов пока нет')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Новый заказ' }).length).toBeGreaterThan(0);
  });
});

describe('SalesList — «Новый заказ»', () => {
  it('свой пустой черновик есть — открывается он, второй не создаётся', async () => {
    vi.mocked(findOwnEmptyDraft).mockResolvedValue({ ok: true, id: 'o-empty' });
    renderList(SELLER);
    await screen.findByText('PH-0101');
    fireEvent.click(screen.getAllByRole('button', { name: 'Новый заказ' })[0]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales/o-empty?tab=item'));
    expect(findOwnEmptyDraft).toHaveBeenCalledWith(ME);
    expect(saveSalesOrder).not.toHaveBeenCalled();
  });

  it('пустого черновика нет — создаётся новый', async () => {
    vi.mocked(findOwnEmptyDraft).mockResolvedValue({ ok: true, id: null });
    vi.mocked(saveSalesOrder).mockResolvedValue({ ok: true, saved: { id: 'o-new', order_number: 'PH-0200', updated_at: 'now' } });
    renderList(SELLER);
    await screen.findByText('PH-0101');
    fireEvent.click(screen.getAllByRole('button', { name: 'Новый заказ' })[0]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales/o-new?tab=item'));
    expect(useSalesStore.getState().current?.id).toBe('o-new');
  });

  it('поиск черновика упал — новый не создаётся', async () => {
    vi.mocked(findOwnEmptyDraft).mockResolvedValue({ ok: false });
    renderList(SELLER);
    await screen.findByText('PH-0101');
    fireEvent.click(screen.getAllByRole('button', { name: 'Новый заказ' })[0]);
    await waitFor(() => expect(findOwnEmptyDraft).toHaveBeenCalled());
    expect(saveSalesOrder).not.toHaveBeenCalled();
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

const MS = { id: 'u-ms', role: 'manager', name: 'Мария', active: true, approved: true, is_sales: false, is_ms: true };
const QUEUE = [
  { ...ROWS[0], id: 'q-1', order_number: 'PH-0201', status: 'ready_to_launch', due_date: '2026-11-05', paid_kind: 'full', sent_at: '2026-10-17T09:00:00Z' },
  { ...ROWS[0], id: 'q-2', order_number: 'PH-0202', status: 'ready_to_launch', due_date: '2026-10-25', paid_kind: null, paid_override_reason: 'постоянный клиент', sent_at: '2026-10-18T09:00:00Z' },
  { ...ROWS[0], id: 'q-3', order_number: 'PH-0203', status: 'draft', due_date: '2026-10-20' },
];

describe('SalesList — пресет «К запуску» (веха 6+7, К22)', () => {
  it('МС: заголовок «К запуску», только ждущие запуска, по сроку; оплата и дата отправки', async () => {
    vi.mocked(fetchSalesOrders).mockResolvedValue(QUEUE.map((r) => ({ ...r })));
    renderList(MS, '/sales?status=ready_to_launch&sort=due');
    expect(await screen.findByRole('heading', { name: 'К запуску' })).toBeInTheDocument();
    const rows = bodyRows();
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['PH-0202', 'PH-0201']);
    expect(within(rows[0]).getByText('Без оплаты (разрешено)')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Оплачен')).toBeInTheDocument();
    expect(within(rows[1]).getByText('17.10.2026')).toBeInTheDocument();
    expect(screen.getByLabelText('Порядок')).toHaveValue('due');
  });

  it('строка, ждущая запуска, у МС ведёт на экран запуска', async () => {
    vi.mocked(fetchSalesOrders).mockResolvedValue(QUEUE.map((r) => ({ ...r })));
    renderList(MS, '/sales?status=ready_to_launch&sort=due');
    fireEvent.click(await screen.findByRole('button', { name: 'PH-0202' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/sales/q-2/launch');
  });

  it('у продавца та же строка ведёт в карточку, заголовок — свой', async () => {
    vi.mocked(fetchSalesOrders).mockResolvedValue(QUEUE.map((r) => ({ ...r })));
    renderList(SELLER, '/sales?status=ready_to_launch');
    expect(await screen.findByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PH-0202' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/sales\/q-2$/);
  });

  it('очередь пуста — «Заказов к запуску нет — менеджеры ещё не отправили»', async () => {
    vi.mocked(fetchSalesOrders).mockResolvedValue([{ ...QUEUE[2] }]);
    renderList(MS, '/sales?status=ready_to_launch&sort=due');
    expect(await screen.findByText('Заказов к запуску нет — менеджеры ещё не отправили')).toBeInTheDocument();
  });

  it('порядок «По сроку сдачи» пишется в адрес', async () => {
    renderList(ADMIN);
    await screen.findByText('PH-0101');
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: 'due' } });
    await waitFor(() => expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['PH-0101', 'PH-0102', 'PH-0103']));
  });
});
