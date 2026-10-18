import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SizeTable from './SizeTable';
import { useStore } from '../../../store/useStore';

beforeEach(() => {
  useStore.getState().resetItemFields();
  useStore.setState({ type: 'tshirt', sizes: { M: 3 }, customSizes: [{ label: '5XL', qty: 2 }] });
});

/** Число ячеек в каждой строке настольной таблицы (шапка, размеры, итог) */
function cellCounts(container) {
  const table = within(container).getByRole('table');
  return [...table.querySelectorAll('tr')].map((tr) => tr.children.length);
}

describe('SizeTable — свой размер', () => {
  it('без цены у строки своего размера столько же колонок, сколько в шапке', () => {
    const { container } = render(<SizeTable showPrice={false} />);
    expect(new Set(cellCounts(container))).toEqual(new Set([2]));
    // ✕ есть и в таблице, и в мобильном списке — оба называют размер
    expect(screen.getAllByRole('button', { name: 'Удалить размер 5XL' })).toHaveLength(2);
  });

  it('с ценой колонок четыре во всех строках, ✕ — у суммы', () => {
    const { container } = render(<SizeTable />);
    expect(new Set(cellCounts(container))).toEqual(new Set([4]));
    expect(screen.getAllByRole('button', { name: 'Удалить размер 5XL' })).toHaveLength(2);
  });
});
