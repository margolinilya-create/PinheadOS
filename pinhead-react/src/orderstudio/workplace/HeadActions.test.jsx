import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { newSalesItem, newSalesOrder } from '../model/factory';
import HeadActions from './HeadActions';

/** «Повторить заказ» (веха 5в, Э8): у того, кто заводит заказы, и у заказа с позициями */
const live = { active: true, approved: true, profileStatus: 'active' };
const seller = { id: 'u1', role: 'manager', is_sales: true, ...live };
const ms = { id: 'u2', role: 'manager', is_sales: false, is_ms: true, ...live };
const order = (patch = {}) => newSalesOrder({ id: 'o1', number: 'PH-1', status: 'done', items: [newSalesItem()], ...patch });

function show(user, o) {
  render(<MemoryRouter><HeadActions order={o} user={user} blocking={0} onGoSend={vi.fn()} /></MemoryRouter>);
}

describe('HeadActions — «Повторить заказ»', () => {
  it('продавцу на заказе с позициями — есть', () => {
    show(seller, order());
    expect(screen.getByRole('button', { name: 'Повторить заказ' })).toBeEnabled();
  });

  it('МС без признака продавца и заказ без позиций — нет', () => {
    show(ms, order());
    expect(screen.queryByRole('button', { name: 'Повторить заказ' })).toBeNull();
  });

  it('заказ без позиций — нет', () => {
    show(seller, order({ items: [] }));
    expect(screen.queryByRole('button', { name: 'Повторить заказ' })).toBeNull();
  });
});
