import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OrderCard from './OrderCard';
import { useErpStore } from '../store/useErpStore';

/**
 * Карточка заказа была одной простынёй: маршрут, ТЗ на каждую позицию,
 * материалы, файлы, переписка и две ленты истории подряд. До комментариев
 * на заказе с тремя позициями надо было прокрутить несколько экранов.
 *
 * Здесь проверяется не вёрстка, а два обещания вкладок: контент действительно
 * разделён (а не спрятан визуально) и вкладка переживает пересылку ссылки.
 */

/**
 * Права мокаются, потому что иначе их не проверить нигде: e2e идут против
 * dev-автологина, а он по построению обходит матрицу (`isDev || isAllowed`).
 * `canOrderManage` переключается тестом, который проверяет режим чтения.
 */
let canOrderManage = true;
vi.mock('../store/useErpAccess', () => ({
  useErpAccess: () => ({
    can: (p) => (p === 'order.manage' ? canOrderManage : true),
    canActIn: () => true,
    isPrivileged: true,
  }),
}));

const DEPTS = [{ id: 'd1', code: 'sewing', name: 'Швейный', active: true, sort_order: 10 }];

const ORDER = {
  id: 'o1', status: 'active', title: 'Худи «Ромашка»', bitrix_id: '4821',
  manager: 'Иванова Мария', customer: 'BOX39', due_date: '2026-09-01',
  launch_date: '2026-08-01', notes: null, shipped_status: 'not_shipped',
  items: [{
    id: 'i1', product_type: 'Худи', qty: 10, sort_order: 10,
    branding_methods: [], production_type: 'own', stages: [
      { id: 's1', item_id: 'i1', department_id: 'd1', status: 'in_progress', depends_on: [], sort_order: 10 },
    ],
  }],
  materials: [{ id: 'm1', name: 'Футер трёхнитка', status: 'ordered', kind: 'fabric', eta_date: '2026-08-20' }],
  attachments: [], procurement_tasks: [], warehouse_tasks: [], warehouse_ops: [],
  tz_documents: [],
};

function renderCard(initialUrl = '/orders/o1', state = undefined) {
  useErpStore.setState({
    orders: [ORDER], departments: DEPTS, loaded: true, detailIds: ['o1'],
    loadOrderBundle: async () => ({ events: [], audit: [], comments: [] }),
    loadOne: async () => ORDER,
    loadAll: async () => {},
  });
  const entry = state ? { pathname: initialUrl, state } : initialUrl;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/orders/:orderId" element={<OrderCard />} /></Routes>
    </MemoryRouter>,
  );
}

describe('OrderCard — вкладки', () => {
  beforeEach(() => {
    canOrderManage = true;
    useErpStore.setState({ orders: [], departments: [], loaded: false, detailIds: [] });
  });

  it('по умолчанию открыты «Позиции», остальные панели не отрисованы', () => {
    renderCard();
    expect(screen.getByRole('tab', { name: /Позиции/ })).toHaveAttribute('aria-selected', 'true');
    // Материалы именно НЕ в документе, а не спрятаны стилями: иначе они
    // остаются в дереве доступности и в поиске по странице
    expect(screen.queryByText(/Футер трёхнитка/)).not.toBeInTheDocument();
  });

  it('вкладка из адреса открывается сразу — ссылку шлют коллегам', () => {
    renderCard('/orders/o1?tab=materials');
    expect(screen.getByRole('tab', { name: /Материалы/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Футер трёхнитка/)).toBeInTheDocument();
  });

  it('несуществующая вкладка в адресе не ломает карточку', () => {
    renderCard('/orders/o1?tab=нетакой');
    expect(screen.getByRole('tab', { name: /Позиции/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('переключение показывает нужную панель', () => {
    renderCard();
    fireEvent.click(screen.getByRole('tab', { name: /Материалы/ }));
    expect(screen.getByText(/Футер трёхнитка/)).toBeInTheDocument();
  });

  it('счётчики на вкладках считают реальное содержимое', () => {
    renderCard();
    expect(within(screen.getByRole('tab', { name: /Позиции/ })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Материалы/ })).getByText('1')).toBeInTheDocument();
    // Ноль показывается тоже: пустая вкладка иначе неотличима от вкладки без счётчика
    expect(within(screen.getByRole('tab', { name: /Файлы/ })).getByText('0')).toBeInTheDocument();
  });

  it('таб-паттерн полный: панель связана с вкладкой, roving tabindex', () => {
    renderCard();
    const active = screen.getByRole('tab', { name: /Позиции/ });
    const other = screen.getByRole('tab', { name: /История/ });
    expect(active).toHaveAttribute('tabindex', '0');
    expect(other).toHaveAttribute('tabindex', '-1');
    expect(active).toHaveAttribute('aria-controls', 'order-tabpanel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'order-tab-items');
  });

  it('стрелка → переводит на соседнюю вкладку и активирует её', () => {
    renderCard();
    const first = screen.getByRole('tab', { name: /Позиции/ });
    first.focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /ТЗ/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('шапка заказа и уведомления остаются вне вкладок', () => {
    renderCard();
    fireEvent.click(screen.getByRole('tab', { name: /История/ }));
    // «Почему заказ стоит» нельзя прятать за переключателем
    expect(screen.getByRole('heading', { name: /Худи «Ромашка»/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Менеджер:/)).toBeInTheDocument();
  });
});

/**
 * Право `order.manage` гейтит правку полей заказа с ОБЕИХ сторон: здесь —
 * интерфейс, на сервере — страж `erp_order_guard` (миграция 20260803280000).
 * Расхождение даёт худший отказ: «поле правится, а сохранение падает 42501».
 */
describe('OrderCard — правка полей под правом order.manage', () => {
  beforeEach(() => {
    canOrderManage = true;
    useErpStore.setState({ orders: [], departments: [], loaded: false, detailIds: [] });
  });

  it('с правом поля правятся', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /^Менеджер:/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Срок клиента:/ })).toBeEnabled();
  });

  it('без права поля показываются НА ЧТЕНИЕ, а не пропадают', () => {
    // Срок и менеджер нужны цеху, чтобы понимать, что он делает, —
    // тот же приём, что у плановых дат этапа.
    canOrderManage = false;
    renderCard();
    const manager = screen.getByRole('button', { name: /^Менеджер:/ });
    expect(manager).toBeDisabled();
    expect(manager).toHaveTextContent('Иванова Мария');
  });

  it('без права гейтятся ВСЕ пять полей, которые сторожит страж', () => {
    canOrderManage = false;
    renderCard();
    for (const label of [/^Клиент:/, /^Менеджер:/, /^Дата запуска:/, /^Срок клиента:/, /^Заметка:/]) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
  });
});

/**
 * Возврат в список.
 *
 * До правки заказчика 16.08 заказ открывался боковой панелью: экран списка
 * не размонтировался, и фильтры, страница и позиция прокрутки переживали
 * просмотр карточки сами собой. Карточка стала страницей — список закрывается,
 * и контекст обязан приезжать в переходе (`location.state.from`). Ссылка
 * «Заказы» без него вела на «Активные» без фильтров и в начало списка,
 * потому что `useScrollRestore` ключуется по `pathname + search`.
 */
describe('OrderCard — возврат в список', () => {
  beforeEach(() => {
    canOrderManage = true;
    useErpStore.setState({ orders: [], departments: [], loaded: false, detailIds: [] });
  });

  it('ведёт туда, откуда пришли, вместе с фильтрами', () => {
    renderCard('/orders/o1', { from: '/orders?tab=archive&filter=overdue&page=3' });
    expect(screen.getByRole('link', { name: /Заказы/ }))
      .toHaveAttribute('href', '/orders?tab=archive&filter=overdue&page=3');
  });

  it('без контекста — обычный список: в заказ приходят и по ссылке от коллеги', () => {
    renderCard();
    expect(screen.getByRole('link', { name: /Заказы/ })).toHaveAttribute('href', '/orders');
  });
});

/**
 * ФИНАЛЬНЫЙ ШАГ «СКЛАД» В ЛЕНТЕ ЭТАПОВ (решение заказчика 21.08).
 *
 * Документ перечисляет «Склад» среди этапов маршрута, а у подряда под ключ
 * маршрут вообще состоит из двух шагов — «Подряд — Склад». Этапом это
 * не заводится (непроизводственный цех не попадает ни в очередь, ни на канбан),
 * поэтому шаг вычисляется из задач склада. Сторож проверяет ровно то, ради
 * чего он заведён: лента не обрывается на последнем цехе.
 */
describe('OrderCard — маршрут не обрывается на последнем цехе', () => {
  beforeEach(() => {
    canOrderManage = true;
    useErpStore.setState({ orders: [], departments: [], loaded: false, detailIds: [] });
  });

  it('лента этапов заканчивается складом', async () => {
    renderCard();
    const strip = await screen.findByLabelText('Лента этапов');
    expect(within(strip).getByText('Склад')).toBeInTheDocument();
    // Именно ПОСЛЕДНИЙ: склад идёт после производства, а не между цехами
    const labels = within(strip).getAllByText(/\S/).map((n) => n.textContent);
    expect(labels[labels.length - 1]).toBe('Склад');
  });
});
