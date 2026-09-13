import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Experimental from './Experimental';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ПРАВКИ ЗАКАЗЧИКА 13.09, ПП. 7 И 8 — экспериментальный цех.
 *
 * П. 7: «в карточках заказов экспериментального цеха оставить один способ
 * открытия — по клику на номер сделки… Сейчас карточка открывается и по номеру
 * сделки, и по названию изделия ниже, из-за чего одно и то же действие
 * дублируется». Причём вели они в РАЗНЫЕ места: номер — на карточку заказа,
 * остальная карточка — в разработку.
 *
 * П. 8: верхнее управление разведено на три уровня — статусы, фильтры
 * по этапам и переключатель вида «Доска / Очередь»; «Все разработки» убраны
 * как дублирующий пункт, «Переданы на склад» и «На примерке» уехали
 * в «Фильтры».
 */

const DEPTS = [
  { id: 'd-emb', code: 'embroidery', name: 'Цех вышивки', active: true, is_production: true, sort_order: 3 },
];

const DEV = {
  id: 'dev-1', order_id: 'o1', item_id: 'i1',
  tech_name: 'Худи «Ромашка» v2', dev_type: 'чёрное', technologist: 'Мария',
  board_stage: 'patterns', outcome: null, handed_to_warehouse_at: null,
  priority: 0, has_3d: false, final_package: {},
  due_date: '2026-09-20', created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z',
  order: { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-09-20' },
  tasks: [],
};

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-09-20', materials: [], procurement_tasks: [],
  items: [{ id: 'i1', order_id: 'o1', product_type: 'Худи', qty: 2, stages: [], prints: [] }],
};

beforeEach(() => {
  useErpStore.setState({
    orders: [ORDER],
    departments: DEPTS,
    experimental: [DEV],
    experimentalLoaded: true,
    experimentalError: null,
    loadExperimental: vi.fn(async () => true),
    loaded: true,
    loadError: null,
    loadAll: vi.fn(async () => true),
    bypasses: [],
    dictionaries: [],
    myDeptId: null,
    myDeptLoaded: true,
    myRole: 'technologist',
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
  });
});

const renderScreen = (path = '/experimental') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/experimental" element={<Experimental />} /></Routes>
  </MemoryRouter>,
);

describe('ЭКС — открытие карточки (п. 7)', () => {
  it('номер сделки открывает РАЗРАБОТКУ, а не заказ', () => {
    renderScreen();
    const link = screen.getByRole('link', { name: '№4821' });
    expect(link).toHaveAttribute('href', '/experimental/dev-1');
  });

  it('название изделия — обычный текст без ссылки и без перехода', () => {
    renderScreen();
    const title = screen.getByText('Худи «Ромашка» v2');
    expect(title.closest('a')).toBeNull();
    /**
     * И сама карточка больше не кликабельна: до правки `onClick` висел
     * на всём контейнере, то есть «переходом» было и название, и пустое
     * место рядом с ним.
     */
    const card = screen.getByRole('listitem', { name: /^Разработка / });
    expect(card).not.toHaveAttribute('tabindex');
  });

  it('второй ссылки на ту же разработку в карточке нет', () => {
    renderScreen();
    const card = screen.getByRole('listitem', { name: /^Разработка / });
    expect(within(card).getAllByRole('link')).toHaveLength(1);
  });
});

describe('ЭКС — три уровня управления (п. 8)', () => {
  it('переключатель вида — ровно «Доска» и «Очередь»', () => {
    renderScreen();
    const group = screen.getByRole('group', { name: 'Вид раздела' });
    const names = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Доска', 'Очередь']);
  });

  it('фильтры по этапам — своя группа, и «Все разработки» в ней нет', () => {
    renderScreen();
    const group = screen.getByRole('group', { name: 'Этап разработки' });
    const names = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual([
      'Лекала', 'Крой', 'Шелкография', 'DTF', 'Вышивка', 'Пошив', 'Финальный этап',
    ]);
    expect(screen.queryByRole('button', { name: 'Все разработки' })).not.toBeInTheDocument();
  });

  it('в постоянной строке статусов нет «Переданы на склад» и «На примерке»', () => {
    renderScreen();
    /**
     * На боевой базе задач типа `fitting` НОЛЬ за всё время — отдельной
     * рабочей очередью состояние не является, и документ разрешает убрать
     * его при этом условии. Механика состояния не тронута: отбор по нему
     * остаётся, но в раскрывающихся «Фильтрах».
     */
    expect(screen.queryByRole('button', { name: /Переданы на склад/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /На примерке/ })).not.toBeInTheDocument();
    // Названные документом — на месте
    for (const label of ['Все', 'Новые', 'В работе', 'Требуют внимания', 'Готовы к серии', 'С проблемой']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('редкие состояния переехали в «Фильтры», а не исчезли', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    const group = screen.getByRole('group', { name: 'Редкие состояния разработки' });
    const names = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(names.join(' ')).toContain('На примерке');
    expect(names.join(' ')).toContain('Переданы на склад');
  });

  it('старая ссылка `?view=list` не даёт пустого экрана — приводит на доску', () => {
    renderScreen('/experimental?view=list');
    const group = screen.getByRole('group', { name: 'Вид раздела' });
    expect(within(group).getByRole('button', { name: 'Доска' }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});
