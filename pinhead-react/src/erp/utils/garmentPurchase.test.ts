import { describe, it, expect } from 'vitest';
import type { SizeGridRow } from '../types';
import {
  isGarmentPurchase, garmentPurchaseCandidates, garmentPurchaseDraft,
  hasGarmentPurchase, garmentPurchaseLabel,
} from './garmentPurchase';

const GRID: SizeGridRow[] = [{ color: '—', sizes: { XS: 10, S: 20, M: 30, L: 25, XL: 15 } }];

const TSHIRT = {
  id: 'i1', product_type: 'Футболка', variant: 'чёрная', qty: 100,
  production_type: 'ready_garment', garment_source: 'purchased', size_grid: GRID,
};
const PEN = {
  id: 'i2', product_type: 'Ручка', qty: 50,
  production_type: 'ready_garment', garment_source: 'purchased', size_grid: null,
};

describe('isGarmentPurchase', () => {
  it('узнаёт закупку изделия по виду', () => {
    expect(isGarmentPurchase({ kind: 'finished_good' })).toBe(true);
  });

  /**
   * Строго с новым значением, никогда отрицанием старых: у строк из кэша
   * и урезанных выборок вида может не быть вовсе, и `!== 'fabric'` объявил бы
   * изделием всю фурнитуру разом.
   */
  it.each([['fabric'], ['hardware'], ['labels'], ['packaging'], ['other']])(
    '%s закупкой изделия не считается', (kind) => {
      expect(isGarmentPurchase({ kind } as never)).toBe(false);
    },
  );

  it('строка без вида не считается изделием', () => {
    expect(isGarmentPurchase(null)).toBe(false);
    expect(isGarmentPurchase({} as never)).toBe(false);
  });
});

describe('garmentPurchaseCandidates', () => {
  it('готовое изделие, которое закупаем мы', () => {
    expect(garmentPurchaseCandidates([TSHIRT, PEN]).map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  /**
   * Давальческое и «склад ГП» закупки не требуют — это решает `garmentSource`,
   * по нему же строится маршрут. Вторая формулировка того же вопроса дала бы
   * закупку у позиции, у которой этапа «Закупка» нет вовсе.
   */
  it.each([['customer'], ['stock']])('источник %s кандидатом не делает', (source) => {
    expect(garmentPurchaseCandidates([{ ...TSHIRT, garment_source: source }])).toEqual([]);
  });

  it('пошив не кандидат — там закупается ткань, а не футболка', () => {
    expect(garmentPurchaseCandidates([{ ...TSHIRT, production_type: 'sewing' }])).toEqual([]);
  });

  /**
   * Категория роли не играет: документ требует «одежда, головные уборы,
   * аксессуары, сувенирная продукция и любые другие готовые позиции».
   */
  it.each([['Кепка'], ['Шоппер'], ['Ручка'], ['Кружка']])('%s — тоже готовое изделие', (type) => {
    expect(garmentPurchaseCandidates([{ ...PEN, product_type: type }])).toHaveLength(1);
  });
});

describe('garmentPurchaseDraft', () => {
  it('изделие с сеткой: одна строка на весь тираж с разбивкой внутри', () => {
    expect(garmentPurchaseDraft(TSHIRT)).toEqual({
      kind: 'finished_good',
      item_id: 'i1',
      name: 'Футболка',
      color: 'чёрная',
      unit: 'шт',
      qty_expected: 100,
      size_grid: GRID,
    });
  });

  it('изделие без сетки: обычное количество', () => {
    const draft = garmentPurchaseDraft(PEN);
    expect(draft?.qty_expected).toBe(50);
    expect(draft?.size_grid).toBeNull();
  });

  it('тираж считается по СЕТКЕ, когда она расходится с полем количества', () => {
    // Сетка — источник правды: её же пересчитает триггер на сервере
    expect(garmentPurchaseDraft({ ...TSHIRT, qty: 7 })?.qty_expected).toBe(100);
  });

  it('пустая сетка не выдаётся за разбивку', () => {
    expect(garmentPurchaseDraft({ ...TSHIRT, size_grid: [] })?.size_grid).toBeNull();
  });

  it('позиции нет — черновика нет', () => {
    expect(garmentPurchaseDraft(null)).toBeNull();
  });
});

describe('hasGarmentPurchase', () => {
  it('видит уже заведённую закупку изделия по позиции', () => {
    const mats = [{ kind: 'finished_good' as const, item_id: 'i1' }];
    expect(hasGarmentPurchase(mats, 'i1')).toBe(true);
    expect(hasGarmentPurchase(mats, 'i2')).toBe(false);
  });

  it('закупка ткани по той же позиции не считается закупкой изделия', () => {
    expect(hasGarmentPurchase([{ kind: 'fabric' as const, item_id: 'i1' }], 'i1')).toBe(false);
  });
});

describe('garmentPurchaseLabel', () => {
  it('называет изделие и общий тираж', () => {
    expect(garmentPurchaseLabel({
      name: 'Футболка', color: 'чёрная', qty_expected: 100, size_grid: GRID,
    })).toBe('Футболка чёрная — 100 шт');
  });

  it('без сетки берёт плановое количество', () => {
    expect(garmentPurchaseLabel({
      name: 'Ручка', color: null, qty_expected: 50, size_grid: null,
    })).toBe('Ручка — 50 шт');
  });
});
