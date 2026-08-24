import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseCard } from './PurchaseCard';
import { useConfirmStore } from '../../../store/useConfirmStore';

/**
 * Карточка закупки одного заказа (правка 23.08, п. 1).
 *
 * Сюда переехали ВСЕ действия закупщика вместе с подтверждениями — раньше
 * они лежали россыпью в строках общего списка. Тесты перенесены оттуда же:
 * правило, которое сторожили в списке, продолжает сторожиться, просто по
 * новому адресу.
 */

const SUPPLY = { id: 'd-sup', code: 'supply', name: 'Закупка', norm_days: 3 };

function stage(patch = {}) {
  return { id: 'st1', department_id: SUPPLY.id, status: 'waiting', ...patch };
}

function order(patch = {}) {
  return {
    id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-08-30',
    items: [{ id: 'i1', stages: [stage()] }],
    materials: [],
    attachments: [],
    ...patch,
  };
}

function renderCard(o = order(), perms = { take: true, complete: true }) {
  const handlers = { onTake: vi.fn(), onClose: vi.fn(), onAddMaterial: vi.fn() };
  render(
    <MemoryRouter>
      <PurchaseCard
        order={o}
        supplyDept={SUPPLY}
        perms={perms}
        today="2026-08-23"
        {...handlers}
      />
    </MemoryRouter>,
  );
  return handlers;
}

/** Подтвердить открытый диалог, при необходимости заполнив поле причины */
function answerDialog(value = '') {
  const st = useConfirmStore.getState();
  expect(st.open, 'диалог не открылся').toBe(true);
  st._close(true, value);
}

beforeEach(() => {
  useConfirmStore.setState({ open: false, prompt: null, _resolver: null });
});

describe('карточка закупки — сводка', () => {
  /**
   * Сводка видна БЕЗ ПРОКРУТКИ и стоит сразу под шапкой (п. 1.3). Перечень
   * плиток берётся из документа дословно; на скриншоте-референсе их четыре,
   * но требование — текст, и он называет шесть.
   */
  it('шесть плиток документа, в его порядке', () => {
    renderCard();
    for (const label of [
      'Всего материалов', 'Не заказано', 'Заказано', 'В пути', 'Пришло', 'Проблемы',
    ]) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
  });

  it('считает, что оформлено, что в пути и что пришло', () => {
    renderCard(order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: 10, qty_ordered: 10 },
      { id: 'm2', name: 'Бирки', source: 'purchase', status: 'in_transit', qty_expected: 5, qty_ordered: 5 },
      { id: 'm3', name: 'Молния', source: 'purchase', status: 'pending', qty_expected: 7 },
    ] }));
    // Подпись и значение — соседи внутри `.kpiBody`: берём общего родителя
    const tile = (label) => screen.getByText(label).parentElement;
    expect(within(tile('Всего материалов')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Заказано')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Не заказано')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Пришло')).getByText('1')).toBeInTheDocument();
  });

  /**
   * «Проблемы или просрочено» — не украшение: у позиции без планового
   * количества приёмка на складе не сверится, и закупка не закроется
   * автоматически НИКОГДА.
   */
  it('позиция без планового количества попадает в «Проблемы» и названа', () => {
    renderCard(order({ materials: [
      { id: 'm1', name: 'Кулирка', source: 'purchase', status: 'pending', qty_expected: null },
    ] }));
    expect(screen.getByText(/Проблемные позиции: Кулирка/)).toBeInTheDocument();
  });

  it('просроченный план прихода — тоже проблема', () => {
    renderCard(order({ materials: [
      { id: 'm1', name: 'Молния', source: 'purchase', status: 'ordered', qty_expected: 5, eta_date: '2026-08-01' },
    ] }));
    expect(screen.getByText(/Проблемные позиции: Молния/)).toBeInTheDocument();
  });
});

describe('карточка закупки — действия', () => {
  it('досрочное закрытие требует причины и передаёт её наверх', async () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить закупку' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    // Поле причины обязательно — этап закрывается пустым
    expect(useConfirmStore.getState().prompt?.required).toBe(true);
    answerDialog('Давальческое сырьё');
    await waitFor(() => expect(h.onClose).toHaveBeenCalledWith('o1', 'Давальческое сырьё'));
  });

  it('всё на месте — обычное подтверждение, без поля причины', async () => {
    const h = renderCard(order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: 10 },
    ] }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить закупку' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    expect(useConfirmStore.getState().prompt).toBeNull();
    answerDialog();
    await waitFor(() => expect(h.onClose).toHaveBeenCalled());
  });

  /**
   * «Взять в работу» СПРАШИВАЕТ СРОК. Без него этап выпадает из контроля
   * сроков целиком: просрочка считается по `planned_end`, «Загрузка цехов»
   * строится из него же.
   */
  it('«Взять в работу» спрашивает план завершения и передаёт его', async () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));

    const { prompt } = useConfirmStore.getState();
    expect(prompt?.type, 'нативный календарь — лучший тач-ввод на планшете').toBe('date');
    expect(prompt?.required, 'пустая дата оставила бы этап без срока').toBe(true);
    expect(prompt?.initialValue, 'поле открывается с предложением, а не пустым')
      .toMatch(/^\d{4}-\d{2}-\d{2}$/);

    answerDialog('2026-09-01');
    await waitFor(() => expect(h.onTake).toHaveBeenCalledWith('o1', '2026-09-01'));
  });

  it('отказ от диалога не берёт закупку в работу', async () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(false);
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(false));
    expect(h.onTake).not.toHaveBeenCalled();
  });

  it('взятая в работу закупка не предлагает взять её снова', () => {
    renderCard(order({ items: [{ id: 'i1', stages: [stage({ status: 'in_progress' })] }] }));
    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
  });

  it('блокировка перебивает всё и показывает причину', () => {
    renderCard(order({ items: [{ id: 'i1', stages: [
      stage({ status: 'blocked', block_reason: 'Нет поставщика' }),
    ] }] }));
    expect(screen.getByText('Заблокировано')).toBeInTheDocument();
    expect(screen.getByText('Нет поставщика')).toBeInTheDocument();
  });

  it('без прав действий нет, но карточка видна', () => {
    // Менеджеру заказа важно видеть, где стоит его заказ, даже без права работать
    renderCard(order(), { take: false, complete: false });
    expect(screen.getByText(/№4821/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Завершить закупку' })).toBeNull();
    // «+ Материал» остаётся: заведение закупочной строки правом не гейтится
    expect(screen.getByRole('button', { name: '+ Материал' })).toBeInTheDocument();
  });

  /**
   * КАРТОЧКА ОТКРЫВАЕТСЯ И ИЗ АРХИВА (правка 24.08, п. 2), а там открытых
   * этапов закупки нет вовсе. Прежде это ломалось трижды: бейдж читал
   * `undefined.variant` и ронял ВЕСЬ экран, «Взять в работу» предлагалось
   * на закрытой закупке, а шапка сообщала «0 позиций в закупке».
   */
  it('завершённая закупка: статус, без действий и без «0 позиций»', () => {
    renderCard(order({ items: [{ id: 'i1', stages: [stage({ status: 'done' })] }] }));
    expect(screen.getByText('Завершено')).toBeInTheDocument();
    expect(screen.getByText(/закупка завершена/)).toBeInTheDocument();
    expect(screen.queryByText(/0 позиций/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Завершить закупку' })).toBeNull();
    // Материалы и история по заказу остаются достижимыми — ради этого архив и есть
    expect(screen.getByRole('button', { name: '+ Материал' })).toBeInTheDocument();
  });

  it('считает открытые этапы заказа, а не все подряд', () => {
    renderCard(order({ items: [
      { id: 'i1', stages: [stage({ id: 'a' })] },
      { id: 'i2', stages: [stage({ id: 'b' })] },
      { id: 'i3', stages: [stage({ id: 'c', status: 'done' })] },
    ] }));
    expect(screen.getByText(/2 позиции в закупке/)).toBeInTheDocument();
  });
});
