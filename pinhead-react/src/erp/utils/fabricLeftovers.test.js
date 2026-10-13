import { describe, expect, it } from 'vitest';
import { fabricLeftovers, leftoverFromRow, leftoverTotals } from './fabricLeftovers';

/**
 * ОСТАТКИ ПОЛОТНА НА СКЛАДЕ (правка заказчика 21.09, п. 5; в метрах —
 * 27.09, п. 4; из серверной выборки — 28.09).
 *
 * Пример 21.09: «склад принял 4 рулона по 20 кг. Закройка израсходовала
 * три рулона полностью и 10 кг из четвёртого… остаток 10 кг. Если цена ткани
 * 700 ₽/кг… „Остаток ткани по заказу: 10 кг / 7 000 ₽"». С 27.09 остаток
 * ведётся в метрах, а килограммы — расчёт по коэффициенту рулона.
 *
 * С 28.09 строки приходят из `erp_fabric_leftovers()` — по ВСЕМ заказам,
 * включая закрытые (раньше остаток сданного заказа пропадал, пока не загружен
 * архив). Отбор usable/used делает сервер; утилита превращает строку в вид.
 */
const row = (n, extra = {}) => ({
  roll_id: `r${n}`,
  label: `Рулон №${n}`,
  seq: n,
  material_id: 'm1',
  material: 'кулирка',
  kind: 'fabric',
  unit: 'кг',
  order_id: 'o1',
  order_title: 'тест закрой 1',
  order_status: 'active',
  width_cm: null, density_gsm: null, length_m: null, length_left_m: null, length_source: null,
  qty: 20, qty_left: 0, kg_per_m: null, price_per_unit: 700, price_per_m: null,
  location: null, status: 'used', created_at: '2026-09-20T10:00:00Z',
  ...extra,
});

/** Рулон, принятый с параметрами: 20 кг × 180 см × 240 г/м² → 46,30 м, 0,432 кг/м */
const metred = (n, extra = {}) => row(n, {
  width_cm: 180, density_gsm: 240, length_m: 46.2963, length_source: 'calc',
  kg_per_m: 0.432, price_per_m: 302.4, ...extra,
});

describe('fabricLeftovers', () => {
  it('пригодный остаток в метрах: источник, параметры, стоимость по цене за метр', () => {
    const rows = fabricLeftovers([
      metred(4, { length_left_m: 10, length_source: 'measured', qty_left: 4.32 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rollId: 'r4', label: 'Рулон №4', material: 'кулирка', lengthM: 10, lengthSource: 'measured',
      kg: 4.32, kgSource: 'calc', widthCm: 180, densityGsm: 240, pricePerM: 302.4,
      cost: 3024, orderId: 'o1', orderTitle: 'тест закрой 1', orderClosed: false, orderStatusLabel: null,
    });
  });

  /** Рулон, принятый до учёта в метрах: остаток только в кг, и он не пропадает */
  it('рулон без метража остаётся в списке с килограммами и ценой за кг', () => {
    const rows = fabricLeftovers([row(4, { qty_left: 10 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lengthM: null, lengthSource: null, kg: 10, kgSource: 'entered', cost: 7000, pricePerKg: 700,
    });
  });

  /** Ради этого и переезд на серверную выборку: сданный заказ не прячет остаток */
  it('остаток закрытого заказа виден, со статусом заказа', () => {
    const [l] = fabricLeftovers([metred(1, { length_left_m: 5, order_status: 'done_on_time' })]);
    expect(l.orderClosed).toBe(true);
    expect(l.orderStatusLabel).toBe('Сдан вовремя');
  });

  it('неизвестный статус закрытого заказа подписан общим словом, а не пусто', () => {
    const [l] = fabricLeftovers([metred(1, { length_left_m: 5, order_status: 'archived' })]);
    expect(l.orderStatusLabel).toBe('Закрыт');
  });

  it('место хранения передаётся, пустая строка — «не указано»', () => {
    expect(fabricLeftovers([metred(1, { length_left_m: 5, location: ' Стеллаж А-3 ' })])[0].location)
      .toBe('Стеллаж А-3');
    expect(fabricLeftovers([metred(1, { length_left_m: 5, location: '   ' })])[0].location).toBeNull();
  });

  it('нулевой остаток не строка списка — ни в метрах, ни в кг', () => {
    expect(fabricLeftovers([metred(1, { length_left_m: 0 })])).toEqual([]);
    expect(fabricLeftovers([row(1, { qty_left: 0 })])).toEqual([]);
  });

  /** Цены может не быть у партий, принятых до правки: ноль читался бы как «даром» */
  it('без цены стоимость — не ноль, а неизвестность', () => {
    const [l] = fabricLeftovers([
      metred(1, { length_left_m: 4, price_per_unit: null, price_per_m: null }),
    ]);
    expect(l.cost).toBeNull();
    expect(l.lengthM).toBe(4);
  });

  it('цена за метр — снимок рулона, если записан', () => {
    const [l] = fabricLeftovers([metred(1, { length_left_m: 2, price_per_m: 500, price_per_unit: 900 })]);
    expect(l.cost).toBe(1000);
  });

  it('без записанной цены за метр она считается по цене за кг и коэффициенту', () => {
    const [l] = fabricLeftovers([metred(1, { length_left_m: 10, price_per_m: null })]);
    expect(l.pricePerM).toBeCloseTo(302.4, 2);
  });

  it('числа из RPC строками (numeric) читаются как числа', () => {
    const [l] = fabricLeftovers([row(1, {
      length_left_m: '3.5', length_source: 'supplier', qty_left: '1.512', price_per_m: '300', width_cm: '180',
    })]);
    expect(l).toMatchObject({ lengthM: 3.5, kg: 1.512, cost: 1050, widthCm: 180 });
  });

  it('порядок — материал, затем номер рулона числом (№2 раньше №10)', () => {
    const rows = fabricLeftovers([
      row(10, { qty_left: 1 }),
      row(2, { qty_left: 1 }),
      row(1, { qty_left: 1, material: 'Бязь' }),
    ]);
    expect(rows.map((l) => l.rollId)).toEqual(['r1', 'r2', 'r10']);
  });

  it('пустой ввод не падает', () => {
    expect(fabricLeftovers(null)).toEqual([]);
    expect(fabricLeftovers([null, {}])).toEqual([]);
    expect(leftoverFromRow(undefined)).toBeNull();
  });
});

describe('leftoverTotals', () => {
  const view = (extra) => ({
    rollId: 'a', label: '', material: '', lengthM: null, lengthSource: null,
    kg: null, kgSource: null, widthCm: null, densityGsm: null, pricePerM: null, pricePerKg: null,
    cost: null, orderId: null, orderTitle: '', ...extra,
  });

  it('метры складываются по рулонам с метражом, рулоны без него названы отдельно', () => {
    const totals = leftoverTotals([
      view({ rollId: 'a', lengthM: 10, kg: 4.32, kgSource: 'calc', cost: 3024 }),
      view({ rollId: 'b', lengthM: 2.5, kg: 1.08, kgSource: 'calc', cost: 756 }),
      view({ rollId: 'c', kg: 5, kgSource: 'entered', cost: 3500 }),
    ]);
    expect(totals).toEqual({
      lengthM: 12.5, rollsWithMetres: 2, rollsWithoutMetres: 1, kg: 10.4, cost: 7280, rolls: 3,
    });
  });

  it('когда цены нет ни у одного рулона, итог по деньгам — прочерк, а не ноль', () => {
    expect(leftoverTotals([view({ lengthM: 3 })]).cost).toBeNull();
  });
});
