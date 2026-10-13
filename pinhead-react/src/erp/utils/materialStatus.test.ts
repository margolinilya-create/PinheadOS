import { describe, expect, it } from 'vitest';
import { autoOrderedStatus } from './materialStatus';
import type { ErpMaterial } from '../types';

/**
 * «Заказано» ставится по факту оформления (правка заказчика 24.08, п. 1).
 *
 * Сторожит не подпись, а ПРАВИЛО: какие именно данные считаются оформлением
 * и в каких состояниях подстановка молчит. Ошибка здесь не падает — она
 * тихо объявляет заказанным то, чего никто не заказывал.
 */

function mat(patch: Partial<ErpMaterial> = {}): ErpMaterial {
  return {
    id: 'm', order_id: 'o1', kind: 'fabric', name: 'Кулирка',
    source: 'purchase', status: 'pending', qty_ordered: null, ordered_on: null,
    ...patch,
  } as ErpMaterial;
}

describe('автоматический статус «Заказано»', () => {
  it('количество и дата вместе — материал заказан', () => {
    expect(autoOrderedStatus(mat({ qty_ordered: 110, ordered_on: '2026-08-24' })))
      .toBe('ordered');
  });

  it('одного количества мало — это ещё намерение', () => {
    // Колонка так и называется, «Количество к заказу»: заполнили — собираются
    expect(autoOrderedStatus(mat({ qty_ordered: 110 }))).toBeNull();
  });

  it('одной даты мало — это описка', () => {
    expect(autoOrderedStatus(mat({ ordered_on: '2026-08-24' }))).toBeNull();
  });

  it('нулевое количество не считается заказом', () => {
    expect(autoOrderedStatus(mat({ qty_ordered: 0, ordered_on: '2026-08-24' })))
      .toBeNull();
  });

  it('не закупка — оформлять не у кого', () => {
    for (const source of ['stock', 'client', 'none'] as const) {
      expect(autoOrderedStatus(mat({
        source, qty_ordered: 10, ordered_on: '2026-08-24',
      })), source).toBeNull();
    }
  });

  /**
   * Главный сторож обратного хода: подстановка НЕ ОТКАТЫВАЕТ материал,
   * ушедший вперёд. Иначе правка цены у принятого материала вернула бы его
   * в «Заказано» — и приёмка на складе перестала бы существовать.
   */
  it('вперёд по шкале не откатывает', () => {
    for (const status of ['in_transit', 'partial', 'received', 'reserved', 'not_needed'] as const) {
      expect(autoOrderedStatus(mat({
        status, qty_ordered: 10, ordered_on: '2026-08-24',
      })), status).toBeNull();
    }
  });

  /**
   * Выбор человека сильнее подстановки: он считается ПОСЛЕ патча, поэтому
   * выбранный руками статус уже вывел материал из `pending`.
   */
  it('выбранный руками статус подстановка не перебивает', () => {
    expect(autoOrderedStatus(mat({
      status: 'in_transit', qty_ordered: 110, ordered_on: '2026-08-24',
    }))).toBeNull();
  });
});
