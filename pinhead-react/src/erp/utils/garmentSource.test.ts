import { describe, expect, it } from 'vitest';
import {
  GARMENT_SOURCE_HINTS,
  GARMENT_SOURCE_LABELS,
  GARMENT_SOURCE_ORDER,
  garmentSourceOf,
  isCustomerGarment,
  itemNeedsPurchase,
} from './garmentSource';

/**
 * ДВА СЦЕНАРИЯ ГОТОВОГО ИЗДЕЛИЯ (правки 07.09, п. 4).
 *
 * Главное здесь — ОТРИЦАТЕЛЬНАЯ половина: давальческим позиция становится
 * только по явному значению. Колонка новая, и её нет ни у одной из пяти
 * заведённых на бое позиций `ready_garment`; правило, написанное как
 * `!== 'purchased'`, объявило бы давальческими их все разом и сняло бы
 * закупку у заказов задним числом.
 */

describe('garmentSourceOf', () => {
  it('готовое изделие с явным «customer» — давальческое', () => {
    expect(garmentSourceOf({ production_type: 'ready_garment', garment_source: 'customer' }))
      .toBe('customer');
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
      expect(garmentSourceOf({ production_type: type, garment_source: 'customer' }))
        .toBe('purchased');
    }
  });

  it('пустая позиция разбирается без падения', () => {
    expect(garmentSourceOf(null)).toBe('purchased');
    expect(garmentSourceOf(undefined)).toBe('purchased');
    expect(garmentSourceOf({})).toBe('purchased');
  });
});

describe('следствия сценария', () => {
  it('давальческое не требует закупки, наше — требует', () => {
    const customer = { production_type: 'ready_garment', garment_source: 'customer' };
    const ours = { production_type: 'ready_garment', garment_source: 'purchased' };
    expect(isCustomerGarment(customer)).toBe(true);
    expect(itemNeedsPurchase(customer)).toBe(false);
    expect(isCustomerGarment(ours)).toBe(false);
    expect(itemNeedsPurchase(ours)).toBe(true);
  });

  it('пошив закупку требует, чем бы ни было заполнено поле', () => {
    expect(itemNeedsPurchase({ production_type: 'sewing', garment_source: 'customer' })).toBe(true);
  });
});

describe('подписи', () => {
  it('у каждого сценария есть подпись и объяснение последствий', () => {
    for (const v of GARMENT_SOURCE_ORDER) {
      expect(GARMENT_SOURCE_LABELS[v]).toBeTruthy();
      expect(GARMENT_SOURCE_HINTS[v]).toBeTruthy();
    }
  });

  it('порядок плиток начинается с прежнего поведения', () => {
    // «Закупаем мы» — значение по умолчанию, и оно же стоит первым:
    // иначе форма предлагала бы давальческое как основной случай
    expect(GARMENT_SOURCE_ORDER).toEqual(['purchased', 'customer']);
  });
});
