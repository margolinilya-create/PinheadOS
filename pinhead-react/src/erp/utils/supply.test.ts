import { describe, expect, it } from 'vitest';
import {
  findSupplyDept,
  isMaterialSettled,
  openSupplyStages,
  ordersAwaitingSupply,
  supplyMaterialSummary,
  supplyState,
} from './supply';
import type { ErpDepartment, ErpItemStage, ErpMaterial } from '../types';

/**
 * Дефект, ради которого модуль появился: заказ с этапом «Закупка» и БЕЗ
 * материалов не показывался нигде. Экран закупки строил строки из материалов,
 * автозакрытие требовало непустой список, а очередь и канбан вырезают
 * непроизводственный участок. Здесь проверяется, что закупка считается
 * от ЭТАПА, а материалы — деталь этого этапа, а не условие его существования.
 */

const SUPPLY = { id: 'd-supply', code: 'supply', name: 'Закупка' } as ErpDepartment;
const CUT = { id: 'd-cut', code: 'cut', name: 'Закрой' } as ErpDepartment;
const DEPTS = [CUT, SUPPLY];

function stage(patch: Partial<ErpItemStage>): ErpItemStage {
  return {
    id: 'st', item_id: 'it', department_id: SUPPLY.id, depends_on: [],
    status: 'waiting', ...patch,
  } as ErpItemStage;
}

function order(stages: ErpItemStage[], status = 'active') {
  return { id: 'o1', status, items: [{ stages }] };
}

function material(patch: Partial<ErpMaterial>): ErpMaterial {
  return {
    id: 'm', order_id: 'o1', kind: 'fabric', name: 'Кулирка',
    source: 'purchase', status: 'pending', ...patch,
  } as ErpMaterial;
}

describe('цех закупки берётся из справочника', () => {
  it('находит по коду', () => {
    expect(findSupplyDept(DEPTS)).toBe(SUPPLY);
  });

  it('нет цеха — null, а не бросок', () => {
    // Справочник может не загрузиться; бейдж и экран обязаны это пережить
    expect(findSupplyDept([CUT])).toBeNull();
    expect(findSupplyDept(null)).toBeNull();
  });
});

describe('открытые этапы закупки', () => {
  it('этап без материалов всё равно открыт — ровно тот дефект', () => {
    const o = order([stage({ id: 'a' })]);
    expect(openSupplyStages(o, SUPPLY.id).map((s) => s.id)).toEqual(['a']);
  });

  it('закрытые и пропущенные не считаются', () => {
    const o = order([
      stage({ id: 'a', status: 'done' }),
      stage({ id: 'b', status: 'skipped' }),
      stage({ id: 'c', status: 'in_progress' }),
    ]);
    expect(openSupplyStages(o, SUPPLY.id).map((s) => s.id)).toEqual(['c']);
  });

  it('этапы чужого цеха не попадают', () => {
    const o = order([stage({ id: 'a', department_id: CUT.id })]);
    expect(openSupplyStages(o, SUPPLY.id)).toEqual([]);
  });

  it('этап на каждую позицию — все возвращаются', () => {
    // Материалы принадлежат заказу целиком, поэтому закрывать надо все сразу
    const o = {
      id: 'o1', status: 'active',
      items: [{ stages: [stage({ id: 'a' })] }, { stages: [stage({ id: 'b' })] }],
    };
    expect(openSupplyStages(o, SUPPLY.id).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('нет цеха или заказа — пусто, без броска', () => {
    expect(openSupplyStages(order([stage({})]), null)).toEqual([]);
    expect(openSupplyStages(null, SUPPLY.id)).toEqual([]);
  });
});

describe('состояние закупки по заказу', () => {
  it('блокировка перебивает взятие в работу', () => {
    // Заблокированный этап требует решения раньше, чем «уже занимаются»
    expect(supplyState([
      stage({ status: 'in_progress' }), stage({ status: 'blocked' }),
    ])).toBe('blocked');
  });

  it('взято в работу, если хоть один этап в работе', () => {
    expect(supplyState([stage({ status: 'waiting' }), stage({ status: 'in_progress' })]))
      .toBe('taken');
  });

  it('иначе — открыт', () => {
    expect(supplyState([stage({ status: 'waiting' })])).toBe('open');
    expect(supplyState([])).toBe('open');
  });
});

describe('сводка по материалам заказа', () => {
  it('«на месте» — пришло, со склада или не требуется', () => {
    for (const status of ['received', 'reserved', 'not_needed'] as const) {
      expect(isMaterialSettled(material({ status }))).toBe(true);
    }
    for (const status of ['pending', 'ordered', 'in_transit', 'partial'] as const) {
      expect(isMaterialSettled(material({ status }))).toBe(false);
    }
  });

  it('пустой список НЕ считается готовым', () => {
    // Иначе заказ без заведённых материалов выглядел бы закупленным
    const s = supplyMaterialSummary([]);
    expect(s.total).toBe(0);
    expect(s.allSettled).toBe(false);
  });

  it('считает готовые и общие', () => {
    const s = supplyMaterialSummary([
      material({ id: 'a', status: 'received', qty_expected: 10 }),
      material({ id: 'b', status: 'pending', qty_expected: 5 }),
    ]);
    expect(s).toMatchObject({ total: 2, settled: 1, allSettled: false });
  });

  it('плановое количество требуется только у закупаемых', () => {
    const s = supplyMaterialSummary([
      material({ id: 'a', source: 'purchase', qty_expected: null }),
      material({ id: 'b', source: 'purchase', qty_expected: 0 }),
      material({ id: 'c', source: 'client', qty_expected: null }),
      material({ id: 'd', source: 'purchase', qty_expected: 12 }),
    ]);
    expect(s.missingPlan.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('заказы, ждущие закупки', () => {
  const withSupply = { id: 'a', status: 'active', items: [{ stages: [stage({})] }] };
  const closed = {
    id: 'b', status: 'active', items: [{ stages: [stage({ status: 'done' })] }] };
  const archived = { id: 'c', status: 'done', items: [{ stages: [stage({})] }] };
  const noSupply = {
    id: 'd', status: 'active',
    items: [{ stages: [stage({ department_id: CUT.id })] }] };

  it('только активные с открытым этапом', () => {
    const got = ordersAwaitingSupply([withSupply, closed, archived, noSupply], DEPTS);
    expect(got.map((o) => o.id)).toEqual(['a']);
  });

  it('нет цеха закупки в справочнике — пусто, а не бросок', () => {
    expect(ordersAwaitingSupply([withSupply], [CUT])).toEqual([]);
  });

  it('считает ЗАКАЗЫ, а не этапы', () => {
    // Три позиции дают три этапа, но работа по заказу одна — иначе бейдж
    // показывал бы втрое больше дел, чем есть
    const three = {
      id: 'e', status: 'active',
      items: [
        { stages: [stage({ id: '1' })] },
        { stages: [stage({ id: '2' })] },
        { stages: [stage({ id: '3' })] },
      ],
    };
    expect(ordersAwaitingSupply([three], DEPTS)).toHaveLength(1);
  });
});
