import { describe, expect, it } from 'vitest';
import { fabricLeftovers, leftoverTotals } from './fabricLeftovers';

/**
 * ОСТАТКИ ПОЛОТНА НА СКЛАДЕ (правка заказчика 21.09, п. 5).
 *
 * Пример из документа: «склад принял 4 рулона по 20 кг. Закройка израсходовала
 * три рулона полностью и 10 кг из четвёртого… остаток 10 кг. Если цена ткани
 * 700 ₽/кг… „Остаток ткани по заказу: 10 кг / 7 000 ₽"».
 */
const roll = (n, extra = {}) => ({
  id: `r${n}`,
  material_id: 'm1',
  seq: n,
  label: `Рулон №${n}`,
  qty: 20,
  qty_left: 0,
  leftover_kind: null,
  price_per_unit: 700,
  unit: 'кг',
  status: 'used',
  ...extra,
});

const order = (rolls, extra = {}) => ({
  id: 'o1',
  title: 'тест закрой 1',
  materials: [{
    id: 'm1',
    kind: 'fabric',
    name: 'кулирка',
    color: 'чёрный',
    unit: 'кг',
    price_per_unit: 700,
    fact_name: null,
    fact_color: null,
    rolls,
    ...extra,
  }],
});

describe('fabricLeftovers', () => {
  it('пригодный остаток попадает на склад с весом и стоимостью', () => {
    const rows = fabricLeftovers([order([
      roll(1), roll(2), roll(3),
      roll(4, { qty_left: 10, leftover_kind: 'usable' }),
    ])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: 'Рулон №4', material: 'кулирка', qty: 10, unit: 'кг', cost: 7000,
      orderTitle: 'тест закрой 1',
    });
  });

  /** «Отдельный складской остаток не создавать» — прямой запрет документа */
  it('малый остаток на склад НЕ попадает', () => {
    const rows = fabricLeftovers([order([roll(1, { qty_left: 3, leftover_kind: 'scrap' })])]);
    expect(rows).toEqual([]);
  });

  it('рулон без решения по остатку ещё не остаток склада', () => {
    const rows = fabricLeftovers([order([roll(1, { qty_left: 5, leftover_kind: null })])]);
    expect(rows).toEqual([]);
  });

  it('нулевой остаток не строка списка', () => {
    const rows = fabricLeftovers([order([roll(1, { qty_left: 0, leftover_kind: 'usable' })])]);
    expect(rows).toEqual([]);
  });

  /** Цены может не быть у партий, принятых до правки: ноль читался бы как «даром» */
  it('без цены стоимость — не ноль, а неизвестность', () => {
    const rows = fabricLeftovers([order(
      [roll(1, { qty_left: 4, leftover_kind: 'usable', price_per_unit: null })],
      { price_per_unit: null },
    )]);
    expect(rows[0].cost).toBeNull();
    expect(rows[0].qty).toBe(4);
  });

  it('цена рулона важнее цены материала — она снимок на момент приёмки', () => {
    const rows = fabricLeftovers([order(
      [roll(1, { qty_left: 2, leftover_kind: 'usable', price_per_unit: 500 })],
      { price_per_unit: 900 },
    )]);
    expect(rows[0].cost).toBe(1000);
  });

  it('пустой ввод не падает', () => {
    expect(fabricLeftovers(null)).toEqual([]);
    expect(fabricLeftovers([{ id: 'o1' }])).toEqual([]);
  });
});

describe('leftoverTotals', () => {
  it('килограммы и метры считаются порознь — пересчёта единиц система не делает', () => {
    const rows = [
      { rollId: 'a', qty: 10, unit: 'кг', cost: 7000, label: '', material: '', color: null, price: 700, orderId: null, orderTitle: '' },
      { rollId: 'b', qty: 4, unit: 'м', cost: 800, label: '', material: '', color: null, price: 200, orderId: null, orderTitle: '' },
      { rollId: 'c', qty: 5, unit: 'кг', cost: 3500, label: '', material: '', color: null, price: 700, orderId: null, orderTitle: '' },
    ];
    expect(leftoverTotals(rows)).toEqual([
      { unit: 'кг', qty: 15, cost: 10500, rolls: 2 },
      { unit: 'м', qty: 4, cost: 800, rolls: 1 },
    ]);
  });

  it('когда цены нет ни у одного рулона, итог по деньгам — прочерк, а не ноль', () => {
    const rows = [
      { rollId: 'a', qty: 3, unit: 'кг', cost: null, label: '', material: '', color: null, price: null, orderId: null, orderTitle: '' },
    ];
    expect(leftoverTotals(rows)[0].cost).toBeNull();
  });
});
