import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersPageShell from './OrdersPageShell';

beforeEach(() => cleanup());

function renderAt(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <OrdersPageShell>
        <div data-testid="content">child content</div>
      </OrdersPageShell>
    </MemoryRouter>,
  );
}

describe('OrdersPageShell', () => {
  it('renders both tab links above the children', () => {
    renderAt('/orders');
    expect(screen.getByText('Канбан')).toBeInTheDocument();
    expect(screen.getByText('Таблица')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('Канбан link points at /orders and Таблица at /orders/table', () => {
    renderAt('/orders');
    expect(screen.getByText('Канбан').closest('a')).toHaveAttribute('href', '/orders');
    expect(screen.getByText('Таблица').closest('a')).toHaveAttribute('href', '/orders/table');
  });

  it('Канбан tab is active on /orders (end matcher)', () => {
    renderAt('/orders');
    const kanbanLink = screen.getByText('Канбан').closest('a');
    expect(kanbanLink?.className).toMatch(/navChipActive/);
  });

  it('Таблица tab is active on /orders/table', () => {
    renderAt('/orders/table');
    const tableLink = screen.getByText('Таблица').closest('a');
    expect(tableLink?.className).toMatch(/navChipActive/);
  });

  it('Канбан is NOT active on /orders/table (end matcher prevents prefix match)', () => {
    renderAt('/orders/table');
    const kanbanLink = screen.getByText('Канбан').closest('a');
    expect(kanbanLink?.className ?? '').not.toMatch(/navChipActive/);
  });
});
