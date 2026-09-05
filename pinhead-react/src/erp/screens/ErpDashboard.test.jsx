import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ErpDashboard from './ErpDashboard';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — значит подключить стор должен тест
attachDomainSlices();

/**
 * Обзор производства: KPI-плитки ведут на отфильтрованные списки, уведомления —
 * ссылки на заказ (раньше это был неинтерактивный div).
 */

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный' },
  { id: 'd2', code: 'sewing', name: 'Швейный' },
];

/** Просроченный заказ с открытой дозакупкой — даёт обе строки уведомлений */
const OVERDUE = {
  id: 'o1', status: 'active', title: 'Худи «Ромашка»', bitrix_id: '4821',
  manager: 'Иванов', due_date: '2020-01-01',
  items: [{ id: 'i1', product_type: 'Худи', qty: 10, stages: [
    { id: 's1', department_id: 'd1', status: 'in_progress', depends_on: [] },
  ] }],
  materials: [], attachments: [], procurement_tasks: [{ id: 'p1', status: 'new', source_stage_id: null }],
  warehouse_tasks: [{ id: 'w1', task_type: 'material_receipt', status: 'awaiting' }],
};

/** Все этапы закрыты — заказ готов к отгрузке */
const READY = {
  id: 'o2', status: 'active', title: 'Футболка «Лето»', bitrix_id: '4822',
  manager: 'Петров', due_date: '2030-01-01',
  items: [{ id: 'i2', product_type: 'Футболка', qty: 5, stages: [
    { id: 's2', department_id: 'd2', status: 'done', depends_on: [] },
  ] }],
  materials: [], attachments: [], procurement_tasks: [], warehouse_tasks: [],
};

function renderDashboard(orders = [OVERDUE, READY]) {
  useErpStore.setState({ orders, departments: DEPTS, loaded: true });
  return render(<MemoryRouter><ErpDashboard /></MemoryRouter>);
}

describe('ErpDashboard', () => {
  beforeEach(() => {
    useErpStore.setState({ orders: [], departments: [], loaded: false });
  });

  // Плитка — ссылка, её доступное имя = «подпись + значение»
  const kpi = (label) => screen.getByRole('link', { name: new RegExp(`^${label}`) });

  it('KPI-плитки — ссылки на отфильтрованные списки', () => {
    renderDashboard();
    const links = {
      'Заказов в работе': '/orders',
      'Позиций в работе': '/board',
      'Готовы к отгрузке': '/orders\\?filter=ready',
      'Срок ≤ 3 дней': '/orders\\?filter=urgent',
      'Просрочено': '/orders\\?filter=overdue',
      'Задач на складе': '/warehouse',
    };
    for (const [label, href] of Object.entries(links)) {
      expect(kpi(label), label).toHaveAttribute('href', href.replace(/\\/g, ''));
    }
  });

  it('считает активные заказы, просрочки, готовность и задачи склада', () => {
    renderDashboard();
    const value = (label) => within(kpi(label)).getByText(/^\d+$/);
    expect(value('Заказов в работе')).toHaveTextContent('2');
    expect(value('Просрочено')).toHaveTextContent('1');
    expect(value('Готовы к отгрузке')).toHaveTextContent('1');
    expect(value('Задач на складе')).toHaveTextContent('1');
  });

  it('уведомления кликабельны и ведут на заказ', () => {
    renderDashboard();
    const procurement = screen.getByText(/Дозакупка по заказу №4821/).closest('a');
    expect(procurement).toHaveAttribute('href', '/orders/o1');

    const overdue = screen.getByText(/Просрочен заказ №4821/).closest('a');
    expect(overdue).toHaveAttribute('href', '/orders/o1');
  });

  it('без активных заказов показывает спокойные пустые состояния', () => {
    renderDashboard([]);
    expect(screen.getByText('Активных заказов нет.')).toBeInTheDocument();
    expect(screen.getByText('Всё спокойно — уведомлений нет.')).toBeInTheDocument();
    expect(screen.getByText('Цеха свободны.')).toBeInTheDocument();
  });

  it('быстрые действия ведут на существующие маршруты', () => {
    renderDashboard();
    expect(screen.getByText('Новый заказ').closest('a')).toHaveAttribute('href', '/orders?new=1');
    expect(screen.getByText('Приёмка').closest('a')).toHaveAttribute('href', '/warehouse');
  });
});

/**
 * Ф4: плоский список «Просрочен заказ №…» заменён группами по критичности.
 * На боевых данных 03.08.2026 просрочено 47 из 76 активных, и виджет
 * показывал шесть случайных, молча обрезая остальные сорок один.
 */
describe('ErpDashboard — уведомления сгруппированы по критичности', () => {
  beforeEach(() => {
    useErpStore.setState({ orders: [], departments: [], loaded: false });
  });

  /** Просроченный на N дней заказ (этап не закрыт — иначе это не просрочка) */
  const late = (id, days, extra = {}) => {
    const due = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return {
      id, status: 'active', title: `Заказ ${id}`, bitrix_id: id, due_date: due,
      items: [{ id: `i-${id}`, product_type: 'Худи', qty: 1, stages: [
        { id: `s-${id}`, department_id: 'd1', status: 'in_progress', depends_on: [] },
      ] }],
      materials: [], attachments: [], procurement_tasks: [], warehouse_tasks: [],
      ...extra,
    };
  };

  /**
   * §2.4 обхода 04.09: «что горит» стояло ПОСЛЕДНИМ блоком из семи — полтора
   * экрана прокрутки на 1280×800 и два с половиной на планшете, притом что
   * колокол в шапке ведёт именно сюда. Порядок теперь отвечает на вопросы
   * в том порядке, в каком их задают.
   *
   * Сторож смотрит ПОЛОЖЕНИЕ В ДОКУМЕНТЕ, а не наличие блока: наличие было
   * и до правки. `compareDocumentPosition` — единственный способ спросить
   * «что выше» у разметки, не завися от классов и раскладки.
   */
  it('уведомления стоят выше «Заказов в работе» и «Быстрых действий»', () => {
    renderDashboard([late('a', 3)]);
    const notif = document.querySelector('#notifications');
    const inWork = screen.getByText('Заказы в работе');
    const quick = screen.getByText('Быстрые действия');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(notif.compareDocumentPosition(inWork) & FOLLOWING).toBeTruthy();
    expect(notif.compareDocumentPosition(quick) & FOLLOWING).toBeTruthy();
  });

  it('срочная группа развёрнута, давняя — свёрнута со счётчиком', () => {
    renderDashboard([late('a', 3), late('b', 20), late('c', 90)]);
    const week = screen.getByText('Горит: просрочка до недели').closest('details');
    const month = screen.getByText('Просрочены 8–30 дней').closest('details');
    const stale = screen.getByText('Просрочены больше месяца').closest('details');
    expect(week.open).toBe(true);
    expect(month.open).toBe(false);
    expect(stale.open).toBe(false);
  });

  it('у каждой группы видна подсказка, что с ней делать', () => {
    renderDashboard([late('a', 3)]);
    expect(screen.getByText(/Ещё можно вытянуть/)).toBeInTheDocument();
  });

  it('строка уведомления остаётся ссылкой на заказ', () => {
    renderDashboard([late('a', 3)]);
    const link = screen.getByRole('link', { name: /Просрочен заказ №a/ });
    expect(link).toHaveAttribute('href', '/orders/a');
  });

  it('готовый к отгрузке просроченный заказ в уведомления НЕ попадает', () => {
    // Ждёт логистики, а не производства (решение заказчика 03.08.2026)
    const ready = late('r', 10);
    ready.items[0].stages[0].status = 'done';
    renderDashboard([ready]);
    expect(screen.queryByText(/Просрочен заказ №r/)).not.toBeInTheDocument();
  });

  it('остановленный этап показывается отдельной срочной группой', () => {
    const blocked = late('b', 1);
    blocked.items[0].stages[0].status = 'blocked';
    renderDashboard([blocked]);
    expect(screen.getByText('Остановлено')).toBeInTheDocument();
  });

  it('плитка «Просрочено» показывает разбивку по ступеням', () => {
    renderDashboard([late('a', 3), late('b', 20), late('c', 20)]);
    const tile = screen.getByRole('link', { name: /^Просрочено/ });
    expect(within(tile).getByText(/1–7 дн.: 1/)).toBeInTheDocument();
    expect(within(tile).getByText(/8–30 дн.: 2/)).toBeInTheDocument();
  });

  it('нет уведомлений — честное пустое состояние, а не пустой блок', () => {
    renderDashboard([READY]);
    expect(screen.getByText(/Всё спокойно/)).toBeInTheDocument();
  });
});
