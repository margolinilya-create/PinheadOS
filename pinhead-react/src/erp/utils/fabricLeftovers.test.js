import { describe, expect, it } from 'vitest';
import { fabricLeftovers, leftoverTotals } from './fabricLeftovers';

/**
 * ОСТАТКИ ПОЛОТНА НА СКЛАДЕ (правка заказчика 21.09, п. 5; в метрах —
 * 27.09, п. 4).
 *
 * Пример 21.09: «склад принял 4 рулона по 20 кг. Закройка израсходовала
 * три рулона полностью и 10 кг из четвёртого… остаток 10 кг. Если цена ткани
 * 700 ₽/кг… „Остаток ткани по заказу: 10 кг / 7 000 ₽"». С 27.09 остаток
 * ведётся в метрах, а килограммы — расчёт по коэффициенту рулона.
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
  width_cm: null, density_gsm: null, length_m: null, length_source: null,
  length_left_m: null, length_left_source: null, kg_per_m: null, price_per_m: null,
  ...extra,
});

/** Рулон, принятый с параметрами: 20 кг × 180 см × 240 г/м² → 46,30 м, 0,432 кг/м */
const metred = (n, extra = {}) => roll(n, {
  width_cm: 180, density_gsm: 240, length_m: 46.2963, length_source: 'calc',
  kg_per_m: 0.432, price_per_m: 302.4, ...extra,
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
  it('пригодный остаток в метрах попадает на склад с источником, параметрами и стоимостью по цене за метр', () => {
    const rows = fabricLeftovers([order([
      metred(1), metred(2),
      metred(4, { length_left_m: 10, length_left_source: 'measured', qty_left: 4.32, leftover_kind: 'usable' }),
    ])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: 'Рулон №4', material: 'кулирка', lengthM: 10, lengthSource: 'measured',
      kg: 4.32, kgSource: 'calc', widthCm: 180, densityGsm: 240, pricePerM: 302.4,
      cost: 3024, orderTitle: 'тест закрой 1',
    });
  });

  /** Рулон, принятый до учёта в метрах: остаток только в кг, и он не пропадает */
  it('рулон без метража остаётся в списке с килограммами и ценой за кг', () => {
    const rows = fabricLeftovers([order([roll(4, { qty_left: 10, leftover_kind: 'usable' })])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lengthM: null, lengthSource: null, kg: 10, kgSource: 'entered', cost: 7000, pricePerKg: 700,
    });
  });

  /** «Отдельный складской остаток не создавать» — прямой запрет документа */
  it('малый остаток на склад НЕ попадает', () => {
    const rows = fabricLeftovers([order([metred(1, { length_left_m: 3, leftover_kind: 'scrap' })])]);
    expect(rows).toEqual([]);
  });

  it('рулон без решения по остатку ещё не остаток склада', () => {
    const rows = fabricLeftovers([order([metred(1, { length_left_m: 5, leftover_kind: null })])]);
    expect(rows).toEqual([]);
  });

  it('нулевой остаток не строка списка — ни в метрах, ни в кг', () => {
    expect(fabricLeftovers([order([metred(1, { length_left_m: 0, leftover_kind: 'usable' })])])).toEqual([]);
    expect(fabricLeftovers([order([roll(1, { qty_left: 0, leftover_kind: 'usable' })])])).toEqual([]);
  });

  /** Цены может не быть у партий, принятых до правки: ноль читался бы как «даром» */
  it('без цены стоимость — не ноль, а неизвестность', () => {
    const rows = fabricLeftovers([order(
      [metred(1, { length_left_m: 4, leftover_kind: 'usable', price_per_unit: null, price_per_m: null })],
      { price_per_unit: null },
    )]);
    expect(rows[0].cost).toBeNull();
    expect(rows[0].lengthM).toBe(4);
  });

  it('цена за метр рулона — снимок на момент приёмки, а не текущая цена материала', () => {
    const rows = fabricLeftovers([order(
      [metred(1, { length_left_m: 2, leftover_kind: 'usable', price_per_m: 500 })],
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
  const row = (extra) => ({
    rollId: 'a', label: '', material: '', color: null, lengthM: null, lengthSource: null,
    kg: null, kgSource: null, widthCm: null, densityGsm: null, pricePerM: null, pricePerKg: null,
    cost: null, orderId: null, orderTitle: '', ...extra,
  });

  it('метры складываются по рулонам с метражом, рулоны без него названы отдельно', () => {
    const totals = leftoverTotals([
      row({ rollId: 'a', lengthM: 10, kg: 4.32, kgSource: 'calc', cost: 3024 }),
      row({ rollId: 'b', lengthM: 2.5, kg: 1.08, kgSource: 'calc', cost: 756 }),
      row({ rollId: 'c', kg: 5, kgSource: 'entered', cost: 3500 }),
    ]);
    expect(totals).toEqual({
      lengthM: 12.5, rollsWithMetres: 2, rollsWithoutMetres: 1, kg: 10.4, cost: 7280, rolls: 3,
    });
  });

  it('когда цены нет ни у одного рулона, итог по деньгам — прочерк, а не ноль', () => {
    expect(leftoverTotals([row({ lengthM: 3 })]).cost).toBeNull();
  });
});

/**
 * ЦВЕТ НЕ ДУБЛИРУЕТСЯ (находка стенда 22.09).
 *
 * Экран печатал «Футер 3-нитка, чёрный · чёрный»: имя ткани на бою уже
 * содержит цвет, и колонка `color` хранит его же. Поймано глазами на стенде,
 * а не тестом, — поэтому сторож ставится здесь.
 */
describe('цвет в подписи остатка', () => {
  const orderWith = (name, color) => ([{
    id: 'o1', title: 'Заказ', materials: [{
      id: 'm1', name, color, unit: 'кг', price_per_unit: 700,
      rolls: [{ id: 'r1', label: 'Рулон №1', qty: 40, unit: 'кг', qty_left: 10, leftover_kind: 'usable' }],
    }],
  }]);

  it('цвет уже в имени — второй раз не печатается', () => {
    expect(fabricLeftovers(orderWith('Футер 3-нитка, чёрный', 'чёрный'))[0].color).toBe(null);
  });

  it('регистр не обманывает проверку', () => {
    expect(fabricLeftovers(orderWith('Футер 3-нитка, Чёрный', 'чёрный'))[0].color).toBe(null);
  });

  it('цвета в имени нет — колонка нужна: иначе рулон не найти на складе', () => {
    expect(fabricLeftovers(orderWith('Футер 3-нитка', 'чёрный'))[0].color).toBe('чёрный');
  });

  it('пустой цвет не превращается в пустую подпись', () => {
    expect(fabricLeftovers(orderWith('Футер 3-нитка', '  '))[0].color).toBe(null);
  });
});
