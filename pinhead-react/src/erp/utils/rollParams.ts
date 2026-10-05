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
import { lengthFromWeight, roundM } from './fabricMetres';

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

/**
 * ОДИН РУЛОН — ОДНА СТРОКА (правка заказчика 05.10, п. 4).
 *
 * «Количество рулонов считать по строкам»: отдельного поля числа больше
 * нет, строка заводится кнопкой и удаляется своей. Ширина и плотность
 * подставляются из закупки СРАЗУ в строку — кладовщик видит, из чего
 * считается метраж, и меняет их у конкретного рулона.
 */
type FabricDefaults = { width_cm?: number | null; density_gsm?: number | null } | null | undefined;

const asInput = (n: number | null | undefined): string => (
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : String(n));

export function newRollRow(material: FabricDefaults): RollParamsInput {
  return {
    weight: '',
    width: asInput(material?.width_cm),
    density: asInput(material?.density_gsm),
    length: '',
  };
}

/**
 * Метраж строки: расчётный (вес / (ширина м × плотность кг/м²)) и
 * фактический, если введён. «Если фактический метраж указан, использовать
 * его. Если нет – расчётный, с пометкой „расчёт"» — `used`/`source`.
 * Пустые ширина и плотность строки берутся из закупки (так же их
 * подставит сервер, `erp_roll_recalc`).
 */
export function rollRowMetres(
  row: RollParamsInput | null | undefined,
  material?: FabricDefaults,
): { calc: number | null; actual: number | null; used: number | null; source: LengthSource | null } {
  const width = positive(row?.width) ?? material?.width_cm ?? null;
  const density = positive(row?.density) ?? material?.density_gsm ?? null;
  const calc = lengthFromWeight(row?.weight, width, density);
  const actual = positive(row?.length);
  if (actual !== null) return { calc, actual, used: actual, source: row?.source ?? 'supplier' };
  return { calc, actual: null, used: calc, source: calc === null ? null : 'calc' };
}

/** Итог строк: число рулонов = число строк, вес и метраж — суммы */
export function rollRowsSummary(
  rows: readonly RollParamsInput[] | null | undefined,
  material?: FabricDefaults,
): { count: number; weight: number; metres: number; metresComplete: boolean; hasCalc: boolean } {
  const list = rows ?? [];
  let metres = 0;
  let metresComplete = list.length > 0;
  let hasCalc = false;
  for (const row of list) {
    const m = rollRowMetres(row, material);
    if (m.used === null) metresComplete = false;
    else metres += m.used;
    if (m.source === 'calc') hasCalc = true;
  }
  return {
    count: list.length,
    weight: weightsSum(list, list.length),
    metres: roundM(metres),
    metresComplete,
    hasCalc,
  };
}
