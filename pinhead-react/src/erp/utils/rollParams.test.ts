import { describe, expect, it } from 'vitest';
import {
  rollWeightsOf, weightsFilled, weightsSum, rollParamsPayload, rollParamsSignature,
} from './rollParams';

describe('параметры рулонов при приёмке (27.09, п. 4)', () => {
  const params = [
    { weight: '20', width: '180', density: '240' },
    { weight: '19.5', length: '45', source: 'measured' as const },
    { weight: '' },
  ];

  it('веса берутся по порядку строк, пустые — null', () => {
    expect(rollWeightsOf(params, 3)).toEqual([20, 19.5, null]);
    expect(rollWeightsOf(params, 2)).toEqual([20, 19.5]);
    expect(rollWeightsOf(null, 2)).toEqual([null, null]);
  });

  it('полнота — все веса положительны; нулевой или отрицательный вес не считается', () => {
    expect(weightsFilled(params, 2)).toBe(true);
    expect(weightsFilled(params, 3)).toBe(false);
    expect(weightsFilled([{ weight: '0' }], 1)).toBe(false);
    expect(weightsFilled([{ weight: '-1' }], 1)).toBe(false);
    expect(weightsFilled([], 0)).toBe(false);
  });

  it('сумма весов округляется до сотых — как допуск сверки на сервере', () => {
    expect(weightsSum([{ weight: '19.4' }, { weight: '19.4' }], 2)).toBe(38.8);
    expect(weightsSum(params, 3)).toBe(39.5);
  });

  /**
   * Ширина и плотность пустые — не шлём: сервер подставит их из материала.
   * Метраж без источника — данные поставщика; со «замер» — как сказано.
   */
  it('payload: вес обязателен, параметры — только введённые, источник метража по умолчанию — поставщик', () => {
    expect(rollParamsPayload(params, 2)).toEqual([
      { weight_kg: 20, width_cm: 180, density_gsm: 240, length_m: null, length_source: null },
      { weight_kg: 19.5, width_cm: null, density_gsm: null, length_m: 45, length_source: 'measured' },
    ]);
    expect(rollParamsPayload([{ weight: '10', length: '30' }], 1)[0].length_source).toBe('supplier');
  });

  it('подпись меняется от любого поля — иначе две разные приёмки слиплись бы в одну попытку', () => {
    const a = rollParamsSignature([{ weight: '20', width: '180' }], 1);
    const b = rollParamsSignature([{ weight: '20', width: '150' }], 1);
    expect(a).not.toBe(b);
    expect(rollParamsSignature([{ weight: '20', width: '180' }], 1)).toBe(a);
  });
});
