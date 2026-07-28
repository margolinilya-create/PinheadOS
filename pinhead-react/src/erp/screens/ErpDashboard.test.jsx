import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ErpDashboard from './ErpDashboard';
import { useErpStore } from '../store/useErpStore';

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
