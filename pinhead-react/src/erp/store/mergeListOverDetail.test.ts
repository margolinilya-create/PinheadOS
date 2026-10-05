import { describe, expect, it } from 'vitest';
import { mergeListOverDetail } from './mergeListOverDetail';
import type { ErpOrderFull } from './types';

/**
 * Правка 05.10, п. 2: «в заказе XS, S, M по 50 шт — в закройке „Размерная
 * сетка заказа не найдена“». `loadAll` заменял полный заказ списочным (без
 * `size_grid`), а `detailIds` оставался, и форма сдачи считала деталь
 * загруженной.
 */
const GRID = [{ color: 'белый', sizes: { XS: 50, S: 50, M: 50 } }];
const full = {
  id: 'o1', title: 'Старое',
  items: [{
    id: 'i1', qty: 150, size_grid: GRID, assembly_cost_per_unit: 120,
    stages: [{ id: 's1', status: 'in_progress', qty_done: 0, notes: 'деталь' }],
  }],
} as unknown as ErpOrderFull;
const list = {
  id: 'o1', title: 'Новое',
  items: [{ id: 'i1', qty: 150, stages: [{ id: 's1', status: 'done', qty_done: 102 }] }],
} as unknown as ErpOrderFull;

describe('mergeListOverDetail', () => {
  it('колонки детали, которых нет в списке, сохраняются; свежее — из списка', () => {
    const [o] = mergeListOverDetail([list], [full], ['o1']);
    expect(o.title).toBe('Новое');
    expect(o.items[0].size_grid).toEqual(GRID);
    expect((o.items[0] as { assembly_cost_per_unit?: number }).assembly_cost_per_unit).toBe(120);
    expect(o.items[0].stages[0].status).toBe('done');
    expect(o.items[0].stages[0].qty_done).toBe(102);
    expect(o.items[0].stages[0].notes).toBe('деталь');
  });

  it('заказ без детали приходит списочным как есть', () => {
    const [o] = mergeListOverDetail([list], [full], []);
    expect(o).toBe(list);
  });

  it('удалённая позиция не воскресает', () => {
    const empty = { ...list, items: [] } as unknown as ErpOrderFull;
    const [o] = mergeListOverDetail([empty], [full], ['o1']);
    expect(o.items).toEqual([]);
  });
});
