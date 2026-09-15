import { describe, expect, it } from 'vitest';
import {
  GARMENT_INTAKE_LABELS,
  GARMENT_SOURCE_HINTS,
  GARMENT_SOURCE_LABELS,
  GARMENT_SOURCE_ORDER,
  garmentIntakeAction,
  garmentSourceOf,
  isCustomerGarment,
  isStockGarment,
  itemNeedsPurchase,
  needsGarmentIntake,
} from './garmentSource';

/**
 * ТРИ СЦЕНАРИЯ ГОТОВОГО ИЗДЕЛИЯ (правки 07.09 п. 4, 14.09 п. 1).
 *
 * Главное здесь — ОТРИЦАТЕЛЬНАЯ половина: незакупаемым изделие становится
 * только по явному значению. Колонка новая, и на бое 14.09 она пуста у ВСЕХ
 * позиций; правило, написанное как `!== 'purchased'`, объявило бы такими их
 * все разом и сняло бы закупку у заказов задним числом.
 *
 * Третье значение добавило второй вид той же ошибки: `garmentSourceOf`,
 * оставленный двоичным (`=== 'customer' ? … : 'purchased'`), читал бы «Склад
 * ГП» как «Закупаем мы» — плитка в форме появилась бы, а маршрут не менялся,
 * и заметил бы это цех. Поэтому каждое значение проверяется поимённо.
 */

describe('garmentSourceOf', () => {
  it('готовое изделие с явным «customer» — давальческое', () => {
    expect(garmentSourceOf({ production_type: 'ready_garment', garment_source: 'customer' }))
      .toBe('customer');
  });

  it('готовое изделие с явным «stock» — со склада готовой продукции', () => {
    expect(garmentSourceOf({ production_type: 'ready_garment', garment_source: 'stock' }))
      .toBe('stock');
  });

  it('готовое изделие без значения — «закупаем мы» (прежнее поведение)', () => {
    for (const value of [undefined, null, '', 'purchased', 'что-то ещё']) {
      expect(garmentSourceOf({ production_type: 'ready_garment', garment_source: value }))
        .toBe('purchased');
    }
  });

  it('у прочих типов производства вопрос не задавался — всегда «закупаем мы»', () => {
    // Значение, оставшееся от переключённой позиции, маршрут менять не должно
    for (const type of ['sewing', 'cut', 'samples', 'outsource', 'no_product']) {
      for (const source of ['customer', 'stock']) {
        expect(garmentSourceOf({ production_type: type, garment_source: source }))
          .toBe('purchased');
      }
    }
  });

  it('пустая позиция разбирается без падения', () => {
    expect(garmentSourceOf(null)).toBe('purchased');
    expect(garmentSourceOf(undefined)).toBe('purchased');
    expect(garmentSourceOf({})).toBe('purchased');
  });
});

describe('следствия сценария', () => {
  const customer = { production_type: 'ready_garment', garment_source: 'customer' };
  const stock = { production_type: 'ready_garment', garment_source: 'stock' };
  const ours = { production_type: 'ready_garment', garment_source: 'purchased' };

  it('закупки требует ТОЛЬКО закупаемое изделие', () => {
    expect(itemNeedsPurchase(ours)).toBe(true);
    expect(itemNeedsPurchase(customer)).toBe(false);
    expect(itemNeedsPurchase(stock)).toBe(false);
  });

  it('признаки сценариев не пересекаются', () => {
    expect(isCustomerGarment(customer)).toBe(true);
    expect(isStockGarment(customer)).toBe(false);
    expect(isStockGarment(stock)).toBe(true);
    expect(isCustomerGarment(stock)).toBe(false);
    expect(isCustomerGarment(ours)).toBe(false);
    expect(isStockGarment(ours)).toBe(false);
  });

  it('этап склада обязателен обоим незакупаемым сценариям и только им', () => {
    // У закупаемого изделия склад появляется только при нанесении — это
    // считает `buildRoute`, а не эта функция.
    expect(needsGarmentIntake(customer)).toBe(true);
    expect(needsGarmentIntake(stock)).toBe(true);
    expect(needsGarmentIntake(ours)).toBe(false);
  });

  it('склад принимает чужое и выдаёт своё — действия разные', () => {
    expect(garmentIntakeAction(customer)).toBe('accept');
    expect(garmentIntakeAction(stock)).toBe('issue');
    // У закупаемого изделия этап склада бывает (при нанесении), но ни
    // «принять», ни «выдать» там неверны: склад передаёт товар в нанесение.
    expect(garmentIntakeAction(ours)).toBeNull();
  });

  it('пошив закупку требует, чем бы ни было заполнено поле', () => {
    for (const source of ['customer', 'stock']) {
      expect(itemNeedsPurchase({ production_type: 'sewing', garment_source: source })).toBe(true);
      expect(needsGarmentIntake({ production_type: 'sewing', garment_source: source })).toBe(false);
    }
  });
});

describe('подписи', () => {
  it('у каждого сценария есть подпись и объяснение последствий', () => {
    for (const v of GARMENT_SOURCE_ORDER) {
      expect(GARMENT_SOURCE_LABELS[v]).toBeTruthy();
      expect(GARMENT_SOURCE_HINTS[v]).toBeTruthy();
    }
  });

  it('форма предлагает ВСЕ сценарии словаря', () => {
    // Порядок — массив, и тайпчек пропуска в нём не ловит: значение, забытое
    // здесь, существует в базе и в маршруте, но выбрать его человек не может.
    expect([...GARMENT_SOURCE_ORDER].sort())
      .toEqual(Object.keys(GARMENT_SOURCE_LABELS).sort());
  });

  it('порядок плиток начинается с прежнего поведения', () => {
    // «Закупаем мы» — значение по умолчанию, и оно же стоит первым:
    // иначе форма предлагала бы давальческое как основной случай
    expect(GARMENT_SOURCE_ORDER[0]).toBe('purchased');
  });

  it('у обоих действий склада своя подпись', () => {
    expect(GARMENT_INTAKE_LABELS.accept).toBeTruthy();
    expect(GARMENT_INTAKE_LABELS.issue).toBeTruthy();
    expect(GARMENT_INTAKE_LABELS.accept).not.toBe(GARMENT_INTAKE_LABELS.issue);
  });
});
