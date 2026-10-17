import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as confirmStore from '../../store/useConfirmStore';
import ItemList from './ItemList';
import { newSalesItem, newSalesOrder } from '../model/factory';

const grid = (color, qty) => ({ sizes: ['M'], rows: [{ color, sizes: { M: qty } }] });

function makeOrder() {
  return newSalesOrder({
    id: 'o-1',
    items: [
      newSalesItem({ key: 'a', product_type: 'Худи', size_grid: grid('Чёрный', 45) }),
      newSalesItem({ key: 'b', product_type: 'Футболка', size_grid: grid('Белый', 10) }),
      newSalesItem({
        key: 'c',
        product_type: 'Свитшот',
        size_grid: { sizes: ['M'], rows: [{ color: 'Серый', sizes: { M: 3 } }, { color: 'Синий', sizes: { M: 4 } }] },
      }),
    ],
  });
}

function setup(props = {}) {
  const handlers = {
    onSelect: vi.fn(), onAdd: vi.fn(), onCopyColor: vi.fn(), onRemove: vi.fn(), onSplit: vi.fn(),
  };
  const utils = render(<ItemList order={makeOrder()} selectedKey="a" {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

/** Обёртка с состоянием: удаление действительно убирает позицию из заказа */
function Stateful({ onSplitItems }) {
  const [order, setOrder] = useState(makeOrder);
  return (
    <ItemList
      order={order}
      selectedKey="a"
      onSelect={() => {}}
      onAdd={() => {}}
      onCopyColor={() => {}}
      onRemove={(key) => setOrder((o) => ({ ...o, items: o.items.filter((it) => it.key !== key) }))}
      onSplit={(key) => setOrder((o) => ({ ...o, items: onSplitItems(o.items, key) }))}
    />
  );
}

const openActions = (title) => fireEvent.click(screen.getByRole('button', { name: `Действия с изделием «${title}»` }));

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('ItemList — список изделий заказа', () => {
  it('список с названиями позиций, у выбранной aria-current', () => {
    setup();
    const list = screen.getByRole('list', { name: 'Изделия заказа' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const current = screen.getByRole('button', { name: 'Худи · Чёрный · 45 шт' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Футболка · Белый · 10 шт' })).not.toHaveAttribute('aria-current');
  });

  it('клик по позиции выбирает её, «+ Изделие» добавляет', () => {
    const { onSelect, onAdd } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Футболка · Белый · 10 шт' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: '+ Изделие' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('меню действий: кнопки с названием позиции; «Разнести» только у многоцветной', () => {
    setup();
    openActions('Худи · Чёрный · 45 шт');
    expect(screen.getByRole('button', { name: 'Копия в другом цвете… — Худи · Чёрный · 45 шт' })).toHaveTextContent('Копия в другом цвете…');
    expect(screen.getByRole('button', { name: 'Удалить — Худи · Чёрный · 45 шт' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Разнести по цветам/ })).toBeNull();
    openActions('Свитшот · Серый, Синий · 7 шт');
    expect(screen.getByRole('button', { name: 'Разнести по цветам — Свитшот · Серый, Синий · 7 шт' })).toBeInTheDocument();
  });

  it('Escape закрывает меню и возвращает фокус на кнопку меню', () => {
    setup();
    openActions('Худи · Чёрный · 45 шт');
    const copy = screen.getByRole('button', { name: /^Копия в другом цвете/ });
    fireEvent.keyDown(copy, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /^Копия в другом цвете/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Действия с изделием «Худи · Чёрный · 45 шт»' })).toHaveFocus();
  });

  it('копия в другом цвете: окно «Цвет новой позиции», кнопка «Создать позицию»', () => {
    const { onCopyColor } = setup();
    openActions('Худи · Чёрный · 45 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Копия в другом цвете/ }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Цвет новой позиции');
    expect(input).toHaveFocus();
    const create = within(dialog).getByRole('button', { name: 'Создать позицию' });
    expect(create).toBeDisabled();
    fireEvent.change(input, { target: { value: '  Красный ' } });
    fireEvent.click(create);
    expect(onCopyColor).toHaveBeenCalledWith('a', 'Красный');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('удаление спрашивает подтверждение с названием', async () => {
    const confirm = vi.spyOn(confirmStore, 'confirm').mockResolvedValue(false);
    const { onRemove } = setup();
    openActions('Худи · Чёрный · 45 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Удалить —/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const opts = confirm.mock.calls[0][0];
    expect(`${opts.title} ${opts.message}`).toBe('Удалить «Худи · Чёрный · 45 шт»? Нанесения и бирки удалятся вместе с ней');
    expect(opts.confirmLabel).toBe('Удалить позицию');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('разнесение спрашивает подтверждение со списком цветов', async () => {
    const confirm = vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    const { onSplit } = setup();
    openActions('Свитшот · Серый, Синий · 7 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Разнести по цветам/ }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledWith('c'));
    const opts = confirm.mock.calls[0][0];
    expect(opts.message).toBe('Позиция станет 2 позициями: Серый, Синий. Нанесения скопируются в каждую');
    expect(opts.confirmLabel).toBe('Разнести на 2 позиции');
  });

  it('после удаления фокус на соседней позиции', async () => {
    vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    render(<Stateful onSplitItems={(items) => items} />);
    openActions('Футболка · Белый · 10 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Удалить —/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Футболка · Белый · 10 шт' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Свитшот · Серый, Синий · 7 шт' })).toHaveFocus());
  });

  it('после удаления последней — фокус на предыдущей', async () => {
    vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    render(<Stateful onSplitItems={(items) => items} />);
    openActions('Свитшот · Серый, Синий · 7 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Удалить —/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Футболка · Белый · 10 шт' })).toHaveFocus());
  });

  it('после разнесения фокус на соседней (первой новой) позиции', async () => {
    vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    const split = (items, key) => items.flatMap((it) => (it.key !== key ? [it] : [
      { ...it, size_grid: { sizes: ['M'], rows: [it.size_grid.rows[0]] } },
      { ...it, key: 'c2', size_grid: { sizes: ['M'], rows: [it.size_grid.rows[1]] } },
    ]));
    render(<Stateful onSplitItems={split} />);
    openActions('Свитшот · Серый, Синий · 7 шт');
    fireEvent.click(screen.getByRole('button', { name: /^Разнести по цветам/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Свитшот · Синий · 4 шт' })).toHaveFocus());
  });

  it('readOnly: только выбор позиции, без «+ Изделие» и действий', () => {
    const { onSelect } = setup({ readOnly: true });
    expect(screen.queryByRole('button', { name: '+ Изделие' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Действия с изделием/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Футболка · Белый · 10 шт' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('XSS: название из разметки выводится текстом', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const order = newSalesOrder({ items: [newSalesItem({ key: 'x', product_type: evil, size_grid: grid(evil, 1) })] });
    const { container } = render(
      <ItemList order={order} selectedKey="x" onSelect={() => {}} onAdd={() => {}} onCopyColor={() => {}} onRemove={() => {}} onSplit={() => {}} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: `${evil} · ${evil} · 1 шт` })).toBeInTheDocument();
  });
});
