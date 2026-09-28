/**
 * ПАРАМЕТРЫ РУЛОНОВ ПРИ ПРИЁМКЕ (правка заказчика 27.09, п. 4).
 *
 * «По каждому рулону хранить: номер, материал и партию закупки, чистый вес
 * в кг без втулки и упаковки, ширину, плотность, расчётный метраж,
 * фактический метраж при наличии и источник метража. Вес всей поставки
 * не делить поровну между рулонами: нужен вес каждого рулона».
 *
 * Форма приёмки держит строки как ВВОД (строки, не числа: поле отдаёт
 * строку, и приведение на каждое нажатие не даёт набрать «19.» перед
 * «19.4»). Здесь — чистые функции над этим вводом: сумма весов, полнота,
 * и то, что уезжает в `erp_material_accept(p_roll_params)`.
 */

import type { LengthSource } from './fabricMetres';

/** Одна строка формы приёмки: всё строками, как в поле ввода */
export interface RollParamsInput {
  weight?: string | number | null;
  width?: string | number | null;
  density?: string | number | null;
  length?: string | number | null;
  source?: 'supplier' | 'measured' | null;
}

function positive(n: string | number | null | undefined): number | null {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Веса первых `count` рулонов по порядку строк; `null` там, где не введён */
export function rollWeightsOf(
  params: readonly RollParamsInput[] | null | undefined,
  count: number,
): (number | null)[] {
  return Array.from({ length: Math.max(count, 0) }, (_, i) => positive(params?.[i]?.weight));
}

/** Все веса введены и положительны */
export function weightsFilled(
  params: readonly RollParamsInput[] | null | undefined,
  count: number,
): boolean {
  return count > 0 && rollWeightsOf(params, count).every((w) => w !== null);
}

/** Сумма введённых весов, округлённая до сотых (допуск сверки с приходом — 0.01) */
export function weightsSum(
  params: readonly RollParamsInput[] | null | undefined,
  count: number,
): number {
  const sum = rollWeightsOf(params, count).reduce<number>((acc, w) => acc + (w ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Что уезжает на сервер. Ширина и плотность пустые — не шлём: сервер
 * подставит их из материала (`erp_roll_recalc`). Метраж без источника
 * считается данными поставщика.
 */
export function rollParamsPayload(
  params: readonly RollParamsInput[] | null | undefined,
  count: number,
): {
    weight_kg: number;
    width_cm: number | null;
    density_gsm: number | null;
    length_m: number | null;
    length_source: LengthSource | null;
  }[] {
  return Array.from({ length: Math.max(count, 0) }, (_, i) => {
    const row = params?.[i] ?? {};
    const length = positive(row.length);
    return {
      weight_kg: positive(row.weight) ?? 0,
      width_cm: positive(row.width),
      density_gsm: positive(row.density),
      length_m: length,
      length_source: length !== null ? (row.source ?? 'supplier') : null,
    };
  });
}

/** Подпись ввода для ключа попытки: та же приёмка — тот же ключ */
export function rollParamsSignature(
  params: readonly RollParamsInput[] | null | undefined,
  count: number,
): string {
  return JSON.stringify(rollParamsPayload(params, count));
}
