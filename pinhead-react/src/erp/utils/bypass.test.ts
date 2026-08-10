import { describe, it, expect } from 'vitest';
import {
  activeBypasses, bypassFor, isActiveBypass, isBypassed, materialsAfterBypass,
} from './bypass';
import type { ErpBypass } from '../types';

const mk = (patch: Partial<ErpBypass>): ErpBypass => ({
  id: 'b1',
  kind: 'material_gate',
  order_id: null,
  reason: 'склад не успевает принять',
  created_by: 'Директор',
  created_by_id: null,
  created_at: '2026-08-10T09:00:00Z',
  restored_by: null,
  restored_by_id: null,
  restored_at: null,
  ...patch,
});

describe('isBypassed — область снятия', () => {
  it('пустой список ничего не снимает', () => {
    expect(isBypassed('material_gate', 'o1', [])).toBe(false);
    expect(isBypassed('material_gate', 'o1', null)).toBe(false);
  });

  it('глобальное снятие действует на любой заказ', () => {
    const list = [mk({ order_id: null })];
    expect(isBypassed('material_gate', 'o1', list)).toBe(true);
    expect(isBypassed('material_gate', 'o2', list)).toBe(true);
  });

  it('снятие по заказу не задевает соседние заказы', () => {
    const list = [mk({ id: 'b2', order_id: 'o1' })];
    expect(isBypassed('material_gate', 'o1', list)).toBe(true);
    expect(isBypassed('material_gate', 'o2', list)).toBe(false);
  });

  it('виды блокировок не путаются между собой', () => {
    const list = [mk({ kind: 'tz_gate' })];
    expect(isBypassed('tz_gate', 'o1', list)).toBe(true);
    expect(isBypassed('material_gate', 'o1', list)).toBe(false);
    expect(isBypassed('ship_gate', 'o1', list)).toBe(false);
  });

  it('возвращённая проверка снова действует', () => {
    const list = [mk({ restored_at: '2026-08-10T12:00:00Z', restored_by: 'Директор' })];
    expect(isBypassed('material_gate', 'o1', list)).toBe(false);
    expect(isActiveBypass(list[0])).toBe(false);
    expect(activeBypasses(list)).toEqual([]);
  });

  it('заказ без id глобальным снятием всё равно покрыт', () => {
    // Снятие «на всю систему» не должно зависеть от того, знает ли вызывающий id
    expect(isBypassed('material_gate', null, [mk({})])).toBe(true);
    expect(isBypassed('material_gate', null, [mk({ order_id: 'o1' })])).toBe(false);
  });
});

describe('bypassFor — что показать человеку', () => {
  it('отдаёт запись с причиной, а не булево', () => {
    const found = bypassFor('material_gate', 'o1', [mk({ reason: 'ткань в пути' })]);
    expect(found?.reason).toBe('ткань в пути');
  });

  it('при двух подходящих берёт более узкое — снятие по заказу', () => {
    const list = [
      mk({ id: 'global', order_id: null, reason: 'общий сбой' }),
      mk({ id: 'byOrder', order_id: 'o1', reason: 'ждём донабор' }),
    ];
    expect(bypassFor('material_gate', 'o1', list)?.id).toBe('byOrder');
    // а для другого заказа остаётся глобальное
    expect(bypassFor('material_gate', 'o2', list)?.id).toBe('global');
  });

  it('нет активного — null', () => {
    expect(bypassFor('ship_gate', 'o1', [mk({})])).toBeNull();
  });
});

/**
 * Гейты принимают материалы параметром, поэтому снятие выражается пустым списком:
 * ни одной новой ветки внутри `isStageReady`/`waitingReason` и ни одного лишнего
 * позиционного аргумента у функций, которых и так шесть.
 */
describe('materialsAfterBypass — снятие без правки самих гейтов', () => {
  const materials = [{ id: 'm1' }, { id: 'm2' }];

  it('без снятия список остаётся прежним (тот же объект)', () => {
    expect(materialsAfterBypass(materials, 'o1', [])).toBe(materials);
  });

  it('со снятием гейт получает пустой список и никого не держит', () => {
    expect(materialsAfterBypass(materials, 'o1', [mk({})])).toEqual([]);
  });

  it('снятие другого вида на материалы не влияет', () => {
    expect(materialsAfterBypass(materials, 'o1', [mk({ kind: 'ship_gate' })])).toBe(materials);
  });
});
