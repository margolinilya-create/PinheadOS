import { describe, expect, it } from 'vitest';
import {
  kgPerMFromParams, lengthFromWeight, kgPerMFromMeasure, pricePerM, kgFromLength,
  fmtM, fmtKg, roundM, roundKg, rollWorkingLength, rollAvailableM, rollKgPerM,
  rollPricePerM, metresMissing, sourceLabel,
} from './fabricMetres';

/**
 * ПРИМЕРЫ ДОКУМЕНТА (правка 27.09, п. 4) — числа взяты из него дословно:
 * «20 кг, ширина 180 см, плотность 240 г/м². Расчётный метраж:
 * 20 × 1000 / (1,8 × 240) = 46,296… м. В интерфейсе: 46,30 м»;
 * «1,8 × 240 / 1000 = 0,432 кг/м»; «цена 950 ₽/кг, коэффициент 0,432 кг/м.
 * Цена метра = 410,40 ₽. Расход 10 м соответствует 4,320 кг и стоимости
 * 4 104 ₽»; «при замере 45 м и весе 20 кг коэффициент равен 20 / 45».
 */
describe('формулы документа', () => {
  it('20 кг × 180 см × 240 г/м² → 46,296… м', () => {
    const m = lengthFromWeight(20, 180, 240);
    expect(m).toBeCloseTo(46.2963, 4);
    expect(fmtM(m)).toBe('46,30 м');
  });

  it('коэффициент по ширине и плотности — 0,432 кг/м', () => {
    expect(kgPerMFromParams(180, 240)).toBeCloseTo(0.432, 10);
  });

  it('950 ₽/кг × 0,432 → 410,40 ₽ за метр; 10 м → 4,320 кг и 4 104 ₽', () => {
    const k = kgPerMFromParams(180, 240);
    const price = pricePerM(950, k);
    expect(price).toBeCloseTo(410.4, 6);
    expect(kgFromLength(10, k)).toBeCloseTo(4.32, 6);
    expect(fmtKg(kgFromLength(10, k))).toBe('4,320 кг');
    expect(Math.round((price ?? 0) * 10)).toBe(4104);
  });

  it('замер 45 м при весе 20 кг — коэффициент 20/45, а не по плотности', () => {
    expect(kgPerMFromMeasure(20, 45)).toBeCloseTo(20 / 45, 10);
  });

  /** Точность в расчётах полная, округляется только показ */
  it('счёт не округляет, округляет подпись', () => {
    const m = lengthFromWeight(20, 180, 240) ?? 0;
    expect(m).not.toBe(roundM(m));
    expect(roundM(m)).toBe(46.3);
    expect(roundKg(4.3204)).toBe(4.32);
    expect(roundKg(4.32049)).toBe(4.32);
    expect(roundKg(4.3205)).toBe(4.321);
  });
});

describe('когда считать не из чего', () => {
  it('нулевые и пустые параметры дают null, а не Infinity', () => {
    expect(kgPerMFromParams(0, 240)).toBeNull();
    expect(kgPerMFromParams(180, null)).toBeNull();
    expect(lengthFromWeight(null, 180, 240)).toBeNull();
    expect(lengthFromWeight(20, '', 240)).toBeNull();
    expect(kgPerMFromMeasure(20, 0)).toBeNull();
    expect(pricePerM(null, 0.432)).toBeNull();
    expect(pricePerM(950, null)).toBeNull();
    expect(kgFromLength(10, null)).toBeNull();
  });

  it('нулевая цена — это цена, а не отсутствие цены', () => {
    expect(pricePerM(0, 0.432)).toBe(0);
  });

  it('подписи: null — прочерк, а не «0,00 м»', () => {
    expect(fmtM(null)).toBe('—');
    expect(fmtM('')).toBe('—');
    expect(fmtKg(undefined)).toBe('—');
    expect(fmtM(0)).toBe('0,00 м');
  });
});

const roll = (extra: Record<string, unknown> = {}) => ({
  qty: 20, length_m: null, length_source: null, length_left_m: null, length_left_source: null,
  kg_per_m: null, price_per_m: null, price_per_unit: 950, ...extra,
});

describe('рабочий метраж рулона', () => {
  it('хранимый метраж сервера главнее любого расчёта', () => {
    const r = roll({ length_m: 45, length_source: 'measured', width_cm: 180, density_gsm: 240 });
    expect(rollWorkingLength(r)).toEqual({ length: 45, source: 'measured', stored: true });
  });

  /**
   * Рулоны, принятые ДО правки, сервер не пересчитывал: показать «46,30 м
   * (расчёт)» по параметрам материала можно, но это НЕ хранимый метраж —
   * расход по нему не запишется, пока сервер его не проставит.
   */
  it('без хранимого метража считает по параметрам материала и говорит, что это не запись', () => {
    const r = roll();
    const got = rollWorkingLength(r, { width_cm: 180, density_gsm: 240 });
    expect(got?.source).toBe('calc');
    expect(got?.stored).toBe(false);
    expect(got?.length).toBeCloseTo(46.2963, 4);
  });

  it('параметры рулона важнее параметров материала — партия уточняется', () => {
    const r = roll({ width_cm: 150 });
    const got = rollWorkingLength(r, { width_cm: 180, density_gsm: 240 });
    expect(got?.length).toBeCloseTo(20 * 1000 / (1.5 * 240), 4);
  });

  it('без веса и без метража — метража нет', () => {
    expect(rollWorkingLength(roll({ qty: null }), { width_cm: 180, density_gsm: 240 })).toBeNull();
    expect(rollWorkingLength(null)).toBeNull();
  });

  it('доступно на начало работы — остаток сервера, а без него весь метраж', () => {
    expect(rollAvailableM(roll({ length_m: 46, length_left_m: 12.5 }))).toBe(12.5);
    expect(rollAvailableM(roll({ length_m: 46 }))).toBe(46);
    expect(rollAvailableM(roll({ length_m: 46, length_left_m: -1 }))).toBe(0);
    expect(rollAvailableM(roll(), null)).toBeNull();
  });

  it('коэффициент и цена за метр: хранимые, а без них — из параметров и цены за кг', () => {
    expect(rollKgPerM(roll({ kg_per_m: 0.5 }))).toBe(0.5);
    expect(rollKgPerM(roll(), { width_cm: 180, density_gsm: 240 })).toBeCloseTo(0.432, 10);
    expect(rollPricePerM(roll({ price_per_m: 400 }))).toBe(400);
    expect(rollPricePerM(roll(), { width_cm: 180, density_gsm: 240 })).toBeCloseTo(410.4, 6);
    expect(rollPricePerM(roll({ price_per_unit: null }), { width_cm: 180, density_gsm: 240 })).toBeNull();
  });
});

describe('чего не хватает для учёта в метрах', () => {
  it('всё есть — пусто', () => {
    expect(metresMissing(roll(), { width_cm: 180, density_gsm: 240 })).toEqual([]);
  });

  it('метраж поставщика снимает вопрос о плотности', () => {
    expect(metresMissing(roll({ length_m: 45, length_source: 'supplier', qty: null }))).toEqual([]);
  });

  it('называет недостающие поимённо', () => {
    expect(metresMissing(roll({ qty: null }), {})).toEqual(['вес', 'ширина', 'плотность']);
    expect(metresMissing(roll(), { width_cm: 180 })).toEqual(['плотность']);
  });

  it('источник метража подписывается словами', () => {
    expect(sourceLabel('calc')).toBe('расчёт');
    expect(sourceLabel('measured')).toBe('замер');
    expect(sourceLabel('supplier')).toBe('по данным поставщика');
    expect(sourceLabel(null)).toBe('расчёт');
  });
});
