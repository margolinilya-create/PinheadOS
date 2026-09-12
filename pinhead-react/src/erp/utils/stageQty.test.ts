import { describe, expect, it } from 'vitest';
import {
  hasStageExtra, stageExtraQty, stageFactLabel, stageFactQty, type QtyStage,
} from './stageQty';

/**
 * ФАКТ СВЕРХ ТИРАЖА (правка заказчика 12.09, п. 5).
 *
 * Пример документа буквально: «заказ 100 шт, фактически выполнено 105 шт»
 * должно сохраняться как «основной тираж — 100 шт, плюс — +5 шт, факт —
 * 105 шт». Проверяется именно он, а не абстрактная арифметика: число из
 * требования — то, что человек будет искать на экране.
 */

const st = (patch: Partial<QtyStage> = {}): QtyStage => ({
  status: 'in_progress', qty_done: 0, ...patch,
} as QtyStage);

describe('факт и «плюс» этапа', () => {
  it('пример документа: заказ 100, факт 105, плюс +5', () => {
    const stage = st({ status: 'done', qty_done: 105 });
    expect(stageFactQty(stage, 100)).toBe(105);
    expect(stageExtraQty(stage, 100)).toBe(5);
    expect(stageFactLabel(stage, 100)).toBe('Заказ 100 · Факт 105 · Плюс +5');
  });

  it('без перевыполнения «плюс» не пишется вовсе', () => {
    // «Плюс +0» — шум, за которым через неделю перестают замечать настоящее
    const stage = st({ status: 'in_progress', qty_done: 60 });
    expect(stageExtraQty(stage, 100)).toBe(0);
    expect(hasStageExtra(stage, 100)).toBe(false);
    expect(stageFactLabel(stage, 100)).toBe('Заказ 100 · Факт 60');
  });

  /**
   * Закрытый БЕЗ набитого числа — это весь тираж: цех мог закрыть этап
   * кнопкой «Готово» или переносом на канбане. То же допущение, что
   * в `utils/progress` и `utils/stageInput`; разойдись они — «принято»
   * на входе следующего этапа не сошлось бы с «сделано» на предыдущем.
   */
  it('закрытый без числа считается сданным целиком', () => {
    expect(stageFactQty(st({ status: 'done', qty_done: 0 }), 100)).toBe(100);
    expect(stageFactQty(st({ status: 'skipped', qty_done: null }), 100)).toBe(100);
    expect(stageExtraQty(st({ status: 'done', qty_done: 0 }), 100)).toBe(0);
  });

  it('незакрытый этап отдаёт ровно то, что набито', () => {
    expect(stageFactQty(st({ qty_done: 40 }), 100)).toBe(40);
    expect(stageFactQty(st({ qty_done: null }), 100)).toBe(0);
  });

  /**
   * Отрицательное количество — ошибка ввода, а не «минус к тиражу».
   * Нижнюю границу легко было снять заодно с потолком, поэтому она здесь.
   */
  it('отрицательный факт читается как ноль', () => {
    expect(stageFactQty(st({ qty_done: -5 }), 100)).toBe(0);
    expect(stageExtraQty(st({ qty_done: -5 }), 100)).toBe(0);
  });

  it('нулевой тираж не делает «плюсом» весь факт наполовину', () => {
    // Тираж 0 — «неизвестно», и весь факт при нём действительно сверх плана
    expect(stageExtraQty(st({ qty_done: 7 }), 0)).toBe(7);
    expect(stageFactLabel(st({ qty_done: 7 }), 0)).toBe('Заказ 0 · Факт 7 · Плюс +7');
  });
});
