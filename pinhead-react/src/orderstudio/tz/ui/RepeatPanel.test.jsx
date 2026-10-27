import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { newSalesItem, newSalesOrder } from '../../model/factory';
import RepeatPanel from './RepeatPanel';

/** «Повторить заказ» (веха 5в, Э8): у того, кто заводит заказы, и у заказа с позициями */
const live = { active: true, approved: true };
const seller = { id: 'u1', role: 'manager', is_sales: true, ...live };
const ms = { id: 'u2', role: 'manager', is_sales: false, is_ms: true, ...live };
const order = (patch = {}) => newSalesOrder({ id: 'o1', number: 'PH-1', status: 'done', items: [newSalesItem()], ...patch });

const show = (user, o) => render(<MemoryRouter><RepeatPanel order={o} user={user} /></MemoryRouter>);

describe('RepeatPanel', () => {
  it('продавцу на заказе с позициями — кнопка с пояснением', () => {
    show(seller, order());
    expect(screen.getByRole('region', { name: 'Повтор заказа' })).toHaveTextContent('Срок и оплату зададите заново');
    expect(screen.getByRole('button', { name: 'Повторить заказ' })).toBeEnabled();
  });

  it.each([
    ['МС без признака продавца', ms, order()],
    ['заказ без позиций', seller, order({ items: [] })],
    ['несохранённый заказ', seller, order({ id: '' })],
  ])('%s — панели нет', (_, user, o) => {
    show(user, o);
    expect(screen.queryByRole('button', { name: 'Повторить заказ' })).toBeNull();
    vi.restoreAllMocks();
  });
});
