import { describe, expect, it } from 'vitest';
import {
  findSupplyDept,
  isMaterialSettled,
  materialAcceptanceIssue,
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
  });

  /**
   * ПУСТОЙ СПИСОК — «ЗАВЕРШЕНО» (правка 24.08, п. 2).
   *
   * Функция принимает ОТКРЫТЫЕ этапы закупки, поэтому пустой список означает
   * ровно одно: открытых не осталось. Раньше он падал в `open`, и архив
   * завершённых закупок помечал каждую строку «Ожидает» — неправда на экране,
   * где заказчик просил показать «Завершено».
   */
  it('нет открытых этапов — закупка завершена, а не ожидает', () => {
    expect(supplyState([])).toBe('done');
  });
});

describe('сводка по материалам заказа', () => {
  it('«на месте» — со склада, не требуется или пришло И ПРИНЯТО складом', () => {
    for (const status of ['reserved', 'not_needed'] as const) {
      expect(isMaterialSettled(material({ status }))).toBe(true);
    }
    for (const status of ['pending', 'ordered', 'in_transit', 'partial'] as const) {
      expect(isMaterialSettled(material({ status }))).toBe(false);
    }
    for (const accept of ['accepted_full', 'accepted_partial'] as const) {
      expect(isMaterialSettled(material({ status: 'received', accept_status: accept }))).toBe(true);
    }
  });

  /**
   * ГЛАВНОЕ, РАДИ ЧЕГО ПРАВИЛО ПЕРЕЕХАЛО К `isMaterialPending` (обход 04.09).
   *
   * `erp_material_accept` ставит `status = 'received'` при ЛЮБОМ исходе
   * приёмки, поэтому формула по одной колонке считала недостачу, пересорт
   * и прямой отказ склада материалом «на месте». Гейт запуска цеха при этом
   * с 22.07 знал правду — и они разошлись: на боевой базе шесть позиций
   * стоят `received` без годной приёмки, у всех шести закупка закрыта
   * автозакрытием, а на заказе 60448 закрой закрыт целиком при трёх
   * непринятых позициях.
   */
  it('пришло, но склад не принял — НЕ «на месте»', () => {
    for (const accept of ['shortage', 'mismatch', 'rejected'] as const) {
      expect(isMaterialSettled(material({ status: 'received', accept_status: accept }))).toBe(false);
    }
    // Приёмки не было вовсе — тоже не «на месте»: строки до 22.07 живут именно так
    expect(isMaterialSettled(material({ status: 'received' }))).toBe(false);
  });

  describe('вердикт склада для закупки', () => {
    it('отказ, пересорт и недостача названы кодом', () => {
      expect(materialAcceptanceIssue(material({ accept_status: 'rejected' }))).toBe('rejected');
      expect(materialAcceptanceIssue(material({ accept_status: 'mismatch' }))).toBe('mismatch');
      expect(materialAcceptanceIssue(material({ accept_status: 'shortage' }))).toBe('shortage');
    });

    it('полная приёмка вопросов не оставляет', () => {
      expect(materialAcceptanceIssue(material({
        accept_status: 'accepted_full', qty_expected: 42, qty_received: 42,
      }))).toBeNull();
      expect(materialAcceptanceIssue(material({ accept_status: null }))).toBeNull();
    });

    /**
     * Числа приезжают из PostgREST СТРОКАМИ (`numeric` → `"42"`). Сравнение
     * строк дало бы `'9' < '10' === false`, то есть недостачу в метр из десяти
     * система объявила бы полной поставкой.
     */
    it('частичная приёмка считается числами, а не строками', () => {
      const short = material({
        accept_status: 'accepted_partial',
        qty_expected: '10' as unknown as number,
        qty_received: '9' as unknown as number,
      });
      expect(materialAcceptanceIssue(short)).toBe('partial');
      expect(materialAcceptanceIssue(material({
        accept_status: 'accepted_partial', qty_expected: 10, qty_received: 10,
      }))).toBeNull();
    });

    /** «Принято частично» ГОДНО в производство — цех работает тем, что приехало */
    it('частичная приёмка не мешает работе, но остаётся проблемой закупки', () => {
      const m = material({
        status: 'received', accept_status: 'accepted_partial',
        qty_expected: 100, qty_received: 40,
      });
      expect(isMaterialSettled(m)).toBe(true);
      expect(supplyMaterialSummary([m]).problems.map((x) => x.id)).toEqual(['m']);
    });

    it('недостача попадает в «Проблемы» закупки', () => {
      const s = supplyMaterialSummary([
        material({ id: 'a', status: 'received', accept_status: 'shortage', qty_expected: 42 }),
        material({ id: 'b', status: 'received', accept_status: 'accepted_full', qty_expected: 5 }),
      ]);
      expect(s.problems.map((m) => m.id)).toEqual(['a']);
      expect(s.allSettled).toBe(false);
    });
  });

  it('пустой список НЕ считается готовым', () => {
    // Иначе заказ без заведённых материалов выглядел бы закупленным
    const s = supplyMaterialSummary([]);
    expect(s.total).toBe(0);
    expect(s.allSettled).toBe(false);
  });

  it('считает готовые и общие', () => {
    const s = supplyMaterialSummary([
      material({ id: 'a', status: 'received', accept_status: 'accepted_full', qty_expected: 10 }),
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
