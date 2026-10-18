import { describe, it, expect } from 'vitest';
import { EMPTY_FILTER, filterFromParams, filterSalesList, isFiltered, sortSalesList } from './salesListFilter';
import type { SalesOrderListRow } from '../api/salesOrders';

const row = (id: string, due: string | null, updated: string, extra: Partial<SalesOrderListRow> = {}): SalesOrderListRow => ({
  id, order_number: `PH-${id}`, title: null, customer: `Клиент ${id}`, status: 'ready_to_launch', price_total: null,
  due_date: due, updated_at: updated, created_by: 'u-1', manager_name: null,
  paid_kind: null, paid_override_reason: null, sent_at: null, erp_order_id: null, ...extra,
});

describe('сортировка списка', () => {
  const rows = [
    row('1', null, '2026-10-18T10:00:00Z'),
    row('2', '2026-10-25', '2026-10-18T09:00:00Z'),
    row('3', '2026-10-20', '2026-10-17T09:00:00Z'),
    row('4', '2026-10-20', '2026-10-18T11:00:00Z'),
    row('5', null, '2026-10-18T12:00:00Z'),
  ];

  it('по сроку: ближний выше, без срока — в конце; при равном сроке — недавно изменённый выше', () => {
    expect(sortSalesList(rows, 'due').map((r) => r.id)).toEqual(['4', '3', '2', '5', '1']);
  });

  it('по изменению — новые выше; исходный массив не меняется', () => {
    const copy = [...rows];
    expect(sortSalesList(rows, 'updated').map((r) => r.id)).toEqual(['5', '4', '1', '2', '3']);
    expect(rows).toEqual(copy);
  });

  it('filterSalesList с sort=due сортирует найденное, с updated — порядок базы', () => {
    expect(filterSalesList(rows, { ...EMPTY_FILTER, sort: 'due' }, null).map((r) => r.id)).toEqual(['4', '3', '2', '5', '1']);
    expect(filterSalesList(rows, { ...EMPTY_FILTER, sort: 'updated' }, null).map((r) => r.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('фильтр из адреса', () => {
  it('пресет «К запуску»: статус и сортировка по сроку', () => {
    const f = filterFromParams(new URLSearchParams('status=ready_to_launch&sort=due'), false);
    expect(f).toEqual({ query: '', status: 'ready_to_launch', mine: false, sort: 'due' });
    expect(isFiltered(f)).toBe(true);
  });

  it('неизвестный статус и сортировка — умолчания; «Мои» только у руководства', () => {
    expect(filterFromParams(new URLSearchParams('status=hack&sort=x&mine=1'), false))
      .toEqual({ query: '', status: '', mine: false, sort: 'updated' });
    expect(filterFromParams(new URLSearchParams('mine=1&q=Иван'), true))
      .toEqual({ query: 'Иван', status: '', mine: true, sort: 'updated' });
  });

  it('статус из адреса фильтрует строки', () => {
    const rows = [row('1', null, 'a', { status: 'draft' }), row('2', null, 'b')];
    const f = filterFromParams(new URLSearchParams('status=draft'), false);
    expect(filterSalesList(rows, f, null).map((r) => r.id)).toEqual(['1']);
  });

  it('сортировка сама по себе фильтром не считается', () => {
    expect(isFiltered({ ...EMPTY_FILTER, sort: 'due' })).toBe(false);
  });
});
