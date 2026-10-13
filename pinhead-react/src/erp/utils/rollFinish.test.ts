import { describe, expect, it } from 'vitest';
import { rollMetresSummary, rollFinishPlan, rollFinishBlock, ROLL_REFINE_REASON_REQUIRED } from './rollFinish';

/**
 * ДАННЫЕ РУЛОНА В ЗАКРОЙКЕ И ЗАВЕРШЕНИЕ РУЛОНА (правка заказчика 05.10, п. 5).
 *
 * «Данные рулона в закройке: номер, материал, цвет, исходный метраж
 * и откуда он взят, записанный расход, доступный остаток». «Из метража
 * вычитать весь сохранённый расход; остаток на экране = проверке при
 * сохранении». «Завершение рулона вынести отдельно: остаток, поле
 * измеренного метража, выбор „оставить пригодный остаток / списать
 * непригодный" — ничего не выбирать за пользователя».
 */

const MATERIAL = { id: 'm1', name: 'Футер', width_cm: 180, density_gsm: 250 };
/** 50 кг, 180 см, 250 г/м² → 111,11 м; списано 40 → сервер ведёт остаток 71,11 */
const ROLL = {
  id: 'r1', seq: 1, label: 'Рулон №1', status: 'in_use', qty: 50,
  length_m: 111.11, length_source: 'calc', length_left_m: 71.11, kg_per_m: 0.45,
};

describe('сводка метража рулона', () => {
  it('из рулона 111,11 м списали 40 — исходный, записано расходом и доступно', () => {
    const s = rollMetresSummary({ roll: ROLL, material: MATERIAL } as never);
    expect(s).toEqual({ initial: 111.11, source: 'calc', spent: 40, available: 71.11 });
  });

  it('нетронутый рулон: расхода нет, доступен весь метраж', () => {
    const s = rollMetresSummary({ roll: { ...ROLL, status: 'in_stock', length_left_m: null }, material: MATERIAL } as never);
    expect(s).toEqual({ initial: 111.11, source: 'calc', spent: 0, available: 111.11 });
  });

  it('фактический метраж — источник поставщик', () => {
    const s = rollMetresSummary({ roll: { ...ROLL, length_m: 109, length_source: 'supplier', length_left_m: 109 }, material: MATERIAL } as never);
    expect(s?.source).toBe('supplier');
    expect(s?.available).toBe(109);
  });

  it('рулон без метража — сводки нет', () => {
    expect(rollMetresSummary({ roll: { ...ROLL, length_m: null, length_left_m: null, qty: null }, material: { id: 'm1' } } as never)).toBeNull();
    expect(rollMetresSummary(null)).toBeNull();
  });
});

describe('план завершения рулона', () => {
  it('замера нет — остаток по записям, метраж не уточняется', () => {
    expect(rollFinishPlan(ROLL as never, '')).toEqual({ left: 71.11, refineLengthM: null, error: null });
  });

  it('замер совпал с записями — уточнять нечего', () => {
    expect(rollFinishPlan(ROLL as never, '71.11').refineLengthM).toBeNull();
  });

  /**
   * Измеренный остаток уезжает уточнением полного метража: сервер
   * (`erp_material_roll_set_params`) вычтет из него весь записанный расход
   * и запишет корректировку с причиной — история расхода не стирается.
   */
  it('замер 70 м при остатке 71,11 — полный метраж уточняется до 110 м', () => {
    const plan = rollFinishPlan(ROLL as never, '70');
    expect(plan.left).toBe(70);
    expect(plan.refineLengthM).toBeCloseTo(110, 2);
    expect(plan.error).toBeNull();
  });

  it('отрицательный замер — ошибка', () => {
    expect(rollFinishPlan(ROLL as never, '-1').error).toMatch(/не может быть отрицательным/);
  });

  it('у рулона без метража замер в метрах не записать', () => {
    expect(rollFinishPlan({ ...ROLL, length_m: null, length_left_m: null } as never, '5').error)
      .toMatch(/нет метража/);
  });
});

describe('что мешает завершить рулон', () => {
  it('остаток есть, выбор не сделан — система за человека не выбирает', () => {
    expect(rollFinishBlock({ left: 71.11, refineLengthM: null, error: null }, null))
      .toMatch(/Выберите, что сделать с остатком/);
  });

  it('выбор сделан — можно', () => {
    expect(rollFinishBlock({ left: 71.11, refineLengthM: null, error: null }, 'usable')).toBeNull();
  });

  it('остатка нет и уточнять нечего — завершать нечего', () => {
    expect(rollFinishBlock({ left: 0, refineLengthM: null, error: null }, null)).toMatch(/Остатка нет/);
  });

  it('замер 0 при остатке по записям — уточнение без выбора судьбы', () => {
    expect(rollFinishBlock({ left: 0, refineLengthM: 40, error: null }, null, 'перемерили')).toBeNull();
  });

  it('замер расходится с записями — без причины не завершить (QA 09.10)', () => {
    const plan = { left: 4, refineLengthM: 48.25, error: null };
    expect(rollFinishBlock(plan, 'usable')).toBe(ROLL_REFINE_REASON_REQUIRED);
    expect(rollFinishBlock(plan, 'usable', '   ')).toBe(ROLL_REFINE_REASON_REQUIRED);
    expect(rollFinishBlock(plan, 'usable', 'перемерили после раскладки')).toBeNull();
  });

  it('ошибка замера важнее выбора', () => {
    expect(rollFinishBlock({ left: 0, refineLengthM: null, error: 'плохо' }, 'scrap')).toBe('плохо');
  });
});
