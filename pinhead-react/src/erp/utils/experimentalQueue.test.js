import { describe, expect, it } from 'vitest';
import { experimentalDept, experimentalDeptEntries } from './experimentalQueue';
import { EXPERIMENTAL_DEPT_CODE, ROUTE_EXTRA_DEPT_CODES } from './routeDraft';

/**
 * Экспериментальный цех как УЧАСТОК МАРШРУТА (правка заказчика 24.08, п. 4.1).
 *
 * «При создании заказа в выпадающий список участков добавить
 * "Экспериментальный цех"… Когда заказ доходит до этого шага, он появляется
 * в очереди экспериментального цеха».
 *
 * Сторожится ровно то, чем этот пункт может сломаться молча: участок
 * непроизводственный, а значит вырезан ИЗ ВСЕХ общих поверхностей. Забыть
 * его собственную очередь — значит спрятать заказ целиком, и заметит это
 * не тест, а цех через неделю простоя.
 */

const EXP = { id: 'd-exp', code: 'experimental', name: 'Экспериментальный цех' };
const SEW = { id: 'd-sew', code: 'sewing', name: 'Швейный', is_production: true };
const DEPTS = [EXP, SEW];

function stage(patch = {}) {
  return {
    id: 'st1', item_id: 'i1', department_id: EXP.id, depends_on: [],
    status: 'ready', qty_done: 0, qty_rework: 0, sort_order: 10, ...patch,
  };
}

function order(stages, patch = {}) {
  return {
    id: 'o1', bitrix_id: '4821', title: 'Худи', status: 'active',
    due_date: '2026-09-01', materials: [],
    items: [{ id: 'i1', product_type: 'Худи', qty: 100, stages }],
    ...patch,
  };
}

describe('участок предлагается в маршруте', () => {
  it('код есть среди участков конструктора', () => {
    // Без этого пункт документа не исполняется вовсе: участок нельзя выбрать
    expect(ROUTE_EXTRA_DEPT_CODES).toContain(EXPERIMENTAL_DEPT_CODE);
  });

  it('участок находится в справочнике по коду', () => {
    expect(experimentalDept(DEPTS)).toBe(EXP);
  });

  it('нет участка в справочнике — null, а не бросок', () => {
    // Справочник может не загрузиться; экран обязан это пережить
    expect(experimentalDept([SEW])).toBeNull();
    expect(experimentalDept(null)).toBeNull();
  });
});

describe('очередь участка', () => {
  it('открытый этап участка попадает в очередь', () => {
    const got = experimentalDeptEntries([order([stage()])], DEPTS);
    expect(got.map((e) => e.stage.id)).toEqual(['st1']);
  });

  /**
   * БЕЗ ОТБОРА ПО `origin` — главное отличие от очередей нанесений. Документ
   * ставит участок в маршрут ОБЫЧНОГО заказа; фильтр «только образцы» скрыл бы
   * ровно то, ради чего пункт и написан, причём молча: очередь выглядела бы
   * рабочей и просто пустой.
   */
  it('серийный заказ виден так же, как образец', () => {
    const serial = experimentalDeptEntries([order([stage({ origin: 'serial' })])], DEPTS);
    const sample = experimentalDeptEntries(
      [order([stage({ id: 'st2', origin: 'sample' })])], DEPTS);
    expect(serial).toHaveLength(1);
    expect(sample).toHaveLength(1);
  });

  it('этапы чужих цехов не попадают', () => {
    const got = experimentalDeptEntries(
      [order([stage({ department_id: SEW.id })])], DEPTS);
    expect(got).toEqual([]);
  });

  it('закрытые этапы в очередь не идут — она про «что делать»', () => {
    for (const status of ['done', 'skipped']) {
      expect(experimentalDeptEntries([order([stage({ status })])], DEPTS), status)
        .toEqual([]);
    }
  });

  it('ожидающий этап остаётся в очереди — он и есть будущая работа', () => {
    const got = experimentalDeptEntries([order([stage({ status: 'waiting' })])], DEPTS);
    expect(got).toHaveLength(1);
  });

  it('нет участка в справочнике — пусто, без броска', () => {
    expect(experimentalDeptEntries([order([stage()])], [SEW])).toEqual([]);
    expect(experimentalDeptEntries(null, DEPTS)).toEqual([]);
  });
});
