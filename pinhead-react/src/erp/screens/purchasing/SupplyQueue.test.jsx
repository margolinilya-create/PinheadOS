import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SupplyQueue } from './SupplyQueue';

/**
 * Очередь закупки — блок, которого не было и из-за отсутствия которого
 * заказ с этапом «Закупка» не показывался нигде.
 *
 * С правки 23.08 (п. 1.1) это ТОЛЬКО НАВИГАЦИЯ: ключевые поля и «Открыть».
 * Действия и их подтверждения переехали в карточку закупки и проверяются
 * в `PurchaseCard.test.jsx` — здесь сторожим, что второй точки входа
 * в те же действия не осталось.
 */

const SUPPLY = { id: 'd-sup', code: 'supply', name: 'Закупка' };

function stage(patch = {}) {
  return { id: 'st1', department_id: SUPPLY.id, status: 'waiting', ...patch };
}

function order(patch = {}) {
  return {
    id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-08-30',
    items: [{ id: 'i1', stages: [stage()] }],
    materials: [],
    ...patch,
  };
}

function renderQueue(orders, { selectedId = null, ...rest } = {}) {
  const onSelect = vi.fn();
  render(
    <MemoryRouter>
      <SupplyQueue
        orders={orders}
        supplyDept={SUPPLY}
        today="2026-08-23"
        selectedId={selectedId}
        onSelect={onSelect}
        {...rest}
      />
    </MemoryRouter>,
  );
  return { onSelect };
}

describe('очередь закупки — навигация', () => {
  it('заказ БЕЗ материалов виден и говорит об этом прямо', () => {
    // Ровно тот заказ, который раньше исчезал: этап есть, материалов нет
    renderQueue([order()]);
    expect(screen.getByText(/№4821/)).toBeInTheDocument();
    expect(screen.getByText('материалы не заведены')).toBeInTheDocument();
  });

  it('пусто — так и написано, а не пустая таблица', () => {
    renderQueue([]);
    expect(screen.getByText(/Заказов, ожидающих закупки, нет/)).toBeInTheDocument();
  });

  it('показывает прогресс материалов «N из M» со шкалой', () => {
    renderQueue([order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: 10 },
      { id: 'm2', name: 'Бирки', source: 'purchase', status: 'pending', qty_expected: 5 },
    ] })]);
    expect(screen.getByText('1 из 2')).toBeInTheDocument();
  });

  it('предупреждает о позициях без планового количества', () => {
    // Без плана приёмка на складе не сверит факт — сделка встанет там
    renderQueue([order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: null },
    ] })]);
    expect(screen.getByText(/без планового кол-ва: 1/)).toBeInTheDocument();
  });

  it('«Открыть» выбирает заказ, а не уводит с экрана', () => {
    const { onSelect } = renderQueue([order()]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onSelect).toHaveBeenCalledWith('o1');
  });

  it('выбранная строка помечена и её кнопка нажата', () => {
    renderQueue([order()], { selectedId: 'o1' });
    const btn = screen.getByRole('button', { name: 'Открыт' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('взятая в работу закупка помечена статусом', () => {
    renderQueue([order({ items: [{ id: 'i1', stages: [stage({ status: 'in_progress' })] }] })]);
    expect(screen.getByText('В работе')).toBeInTheDocument();
  });

  it('блокировка видна статусом', () => {
    renderQueue([order({ items: [{ id: 'i1', stages: [
      stage({ status: 'blocked', block_reason: 'Нет поставщика' }),
    ] }] })]);
    expect(screen.getByText('Заблокировано')).toBeInTheDocument();
  });

  /**
   * ГЛАВНЫЙ СТОРОЖ ЭТОГО ФАЙЛА (п. 1.2): «рабочие действия не держать
   * россыпью в общем списке». Проверяется ОТСУТСТВИЕ — а значит, стоит
   * перечислить их поимённо: пропущенная кнопка вернулась бы молча,
   * и на экране снова оказались бы две рабочие зоны.
   */
  it('рабочих действий в списке нет — они в карточке', () => {
    renderQueue([order()]);
    const row = screen.getByText(/№4821/).closest('tr');
    for (const name of ['Печать', '+ Материал', 'Взять в работу', 'Закупка завершена', 'Завершить закупку']) {
      expect(within(row).queryByRole('button', { name }), name).toBeNull();
      expect(within(row).queryByRole('link', { name }), name).toBeNull();
    }
  });
});

/**
 * АРХИВ ЗАВЕРШЁННЫХ ЗАКУПОК (правка заказчика 24.08, п. 2).
 *
 * Тот же список монтируется внутрь `<details>` внизу страницы закупки.
 * Оба сторожа проверяют то, на что жаловался заказчик, и оба падают
 * на прежнем коде: заголовок рисовался безусловно, а `supplyState([])`
 * отдавал `open` и подписывал каждую архивную строку «Ожидает».
 */
describe('очередь закупки — вложенный архив', () => {
  it('со своим заголовком архив не рисует второй «Заказы в закупке»', () => {
    renderQueue([order()], { title: null });
    expect(screen.queryByRole('heading', { name: /Заказы в закупке/ })).toBeNull();
    // Сам список при этом на месте — снят только заголовок
    expect(screen.getByText(/№4821/)).toBeInTheDocument();
  });

  it('заказ без открытых этапов закупки помечен «Завершено», а не «Ожидает»', () => {
    renderQueue([order({ items: [{ id: 'i1', stages: [stage({ status: 'done' })] }] })]);
    expect(screen.getByText('Завершено')).toBeInTheDocument();
    expect(screen.queryByText('Ожидает')).toBeNull();
  });

  it('пустой архив говорит о себе своими словами', () => {
    renderQueue([], { title: null, emptyText: 'Завершённых закупок нет.' });
    expect(screen.getByText('Завершённых закупок нет.')).toBeInTheDocument();
  });
});
