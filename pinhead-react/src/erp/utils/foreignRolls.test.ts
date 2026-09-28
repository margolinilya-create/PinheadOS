import { describe, expect, it } from 'vitest';
import { foreignRollOptions } from './foreignRolls';
import { rollsForItem, rollsAwaitingFate } from './cutRolls';
import { rollAvailableM } from './fabricMetres';

/**
 * ОСТАТОК РУЛОНА ИДЁТ В ДРУГОЙ ЗАКАЗ (правка 28.09): «если рулон используется
 * в нескольких заказах, каждый следующий заказ получает только его доступный
 * остаток». Строки сервера (`erp_fabric_leftovers` / `erp_order_foreign_rolls`)
 * становятся вариантами формы закроя.
 */
const row = (extra = {}) => ({
  roll_id: 'r9', label: 'Рулон №9', seq: 9, material_id: 'm9', material: 'Футер', unit: 'кг',
  order_id: 'o-old', order_title: 'Худи «Ромашка»', width_cm: 180, density_gsm: 240,
  length_m: 46.3, length_left_m: 10, length_source: 'measured' as const,
  qty: 20, qty_left: 4.32, kg_per_m: 0.432, price_per_unit: 950, price_per_m: 410.4,
  location: 'Стеллаж 3', status: 'used', created_at: '2026-09-20', leftover_kind: 'usable' as const,
  ...extra,
});

describe('foreignRollOptions', () => {
  it('остаток другого заказа — вариант с подписью источника и доступным метражом', () => {
    const [opt] = foreignRollOptions([row()], 'o-new');
    expect(opt.fromOrder).toBe('Худи «Ромашка»');
    expect(opt.label).toContain('остаток заказа «Худи «Ромашка»»');
    expect(rollAvailableM(opt.roll, opt.material)).toBe(10);
  });

  it('свой заказ отсекается, дубли из двух источников — один вариант', () => {
    expect(foreignRollOptions([row({ order_id: 'o-new' })], 'o-new')).toHaveLength(0);
    expect(foreignRollOptions([row(), row()], 'o-new')).toHaveLength(1);
  });

  it('в списке закроя чужие остатки идут после своих рулонов', () => {
    const own = {
      id: 'm1', order_id: 'o-new', item_id: null, kind: 'fabric', name: 'Кулирка',
      status: 'received', accept_status: 'accepted_full',
      rolls: [{ id: 'r1', seq: 1, label: 'Рулон №1', status: 'in_stock', qty: 20 }],
    };
    const list = rollsForItem([own] as never, 'it1', [], foreignRollOptions([row()], 'o-new'));
    expect(list.map((o) => o.roll.id)).toEqual(['r1', 'r9']);
  });

  it('взятый остаток «в работе» без судьбы держит закрытие взявшего заказа', () => {
    const taken = foreignRollOptions([row({ status: 'in_use', leftover_kind: null })], 'o-new');
    const pending = rollsAwaitingFate([], 'it1', { id: 'st1', department_id: 'd' }, [], taken);
    expect(pending.map((o) => o.roll.id)).toEqual(['r9']);
  });
});
