/**
 * УЧЁТ ПОЛОТНА В ПОГОННЫХ МЕТРАХ (правка заказчика 27.09, п. 4).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Перевести ввод расхода и остатка в закройке
 * на погонные метры. В закупке всегда указываются вес в кг и цена за кг.
 * Стоимость за метр система рассчитывает автоматически… Пересчёт выполнять
 * при приёмке каждого рулона на склад; недостающие параметры разрешить
 * заполнить в закройке до записи расхода».
 *
 * ЭТО ОТМЕНЯЕТ ПРАВИЛО СЕССИИ 64 «пересчёта единиц система не делает».
 * Тогда единица была МЕТКОЙ, и складывать «61 кг и 120 м» было нельзя.
 * Теперь у рулона есть коэффициент кг/м — свой у каждого рулона, потому что
 * плотность у каждого артикула своя, — и метры с килограммами связаны
 * через него. Пересчёт есть, но ТОЛЬКО по коэффициенту КОНКРЕТНОГО рулона:
 * общего курса «кг → м» по-прежнему не существует.
 *
 * ФОРМУЛЫ ДОКУМЕНТА (одни и те же здесь и на сервере — `erp_fabric_kg_per_m`,
 * `erp_roll_recalc`; сторож `fabricMetres.test.ts` держит примеры документа):
 *
 *   расчётный метраж = вес, кг × 1000 / (ширина, м × плотность, г/м²)
 *   коэффициент кг/м = ширина, м × плотность, г/м² / 1000
 *                    — либо вес / метраж, когда метраж измерен;
 *   цена за метр     = цена за кг × коэффициент кг/м;
 *   вес расхода      = метры × коэффициент (расчётный, не взвешенный).
 *
 * ТОЧНОСТЬ В РАСЧЁТАХ ПОЛНАЯ, округляется только показ: метры до 0,01,
 * килограммы до 0,001 — прямое требование документа. Поэтому функции
 * счёта возвращают число как есть, а `fmtM`/`fmtKg` округляют в подписи.
 *
 * ШИРИНА — ПОЛНАЯ ширина полотна, а не полезная ширина раскладки: отходы
 * раскладки входят в расход, который называет закройщик.
 */

import type { ErpMaterial, ErpMaterialRoll } from '../types';

/** Откуда взят метраж рулона */
export type LengthSource = 'calc' | 'supplier' | 'measured';

export const LENGTH_SOURCE_LABELS: Record<LengthSource, string> = {
  calc: 'расчёт',
  supplier: 'по данным поставщика',
  measured: 'замер',
};

function positive(n: number | string | null | undefined): number | null {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Коэффициент кг/м по ширине (см) и плотности (г/м²); `null` — параметров нет */
export function kgPerMFromParams(
  widthCm: number | string | null | undefined,
  densityGsm: number | string | null | undefined,
): number | null {
  const w = positive(widthCm);
  const d = positive(densityGsm);
  if (w === null || d === null) return null;
  return (w / 100) * d / 1000;
}

/** Расчётный метраж по весу и параметрам полотна; `null` — считать не из чего */
export function lengthFromWeight(
  weightKg: number | string | null | undefined,
  widthCm: number | string | null | undefined,
  densityGsm: number | string | null | undefined,
): number | null {
  const kg = positive(weightKg);
  const k = kgPerMFromParams(widthCm, densityGsm);
  if (kg === null || k === null) return null;
  return kg / k;
}

/** Коэффициент по замеру: чистый вес / полный метраж того же рулона */
export function kgPerMFromMeasure(
  weightKg: number | string | null | undefined,
  lengthM: number | string | null | undefined,
): number | null {
  const kg = positive(weightKg);
  const m = positive(lengthM);
  if (kg === null || m === null) return null;
  return kg / m;
}

/** Цена за метр = цена за кг × коэффициент; `null`, если чего-то нет */
export function pricePerM(
  pricePerKg: number | string | null | undefined,
  kgPerM: number | string | null | undefined,
): number | null {
  const p = Number(pricePerKg);
  const k = positive(kgPerM);
  if (!Number.isFinite(p) || pricePerKg === null || pricePerKg === undefined || k === null) return null;
  return p * k;
}

/** Расчётный вес отрезка: метры × коэффициент */
export function kgFromLength(
  lengthM: number | string | null | undefined,
  kgPerM: number | string | null | undefined,
): number | null {
  const m = Number(lengthM);
  const k = positive(kgPerM);
  if (!Number.isFinite(m) || k === null) return null;
  return m * k;
}

/** Метры для показа — до 0,01 */
export function roundM(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Килограммы для показа — до 0,001 */
export function roundKg(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** «46,30 м»; `null` — прочерк, а не ноль */
export function fmtM(n: number | string | null | undefined): string {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return '—';
  return `${roundM(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} м`;
}

/** «4,320 кг»; `null` — прочерк */
export function fmtKg(n: number | string | null | undefined): string {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return '—';
  return `${roundKg(v).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} кг`;
}

/** Часть рулона, нужная метражу — чтобы не тянуть весь тип в подписи */
export type RollMetresInput = Pick<
  ErpMaterialRoll,
  'qty' | 'length_m' | 'length_source' | 'length_left_m' | 'length_left_source' | 'kg_per_m' | 'price_per_m'
> & Partial<Pick<ErpMaterialRoll, 'width_cm' | 'density_gsm' | 'price_per_unit'>>;

type MaterialParams = Partial<Pick<ErpMaterial, 'width_cm' | 'density_gsm' | 'price_per_unit'>> | null | undefined;

/**
 * Рабочий метраж рулона и его источник.
 *
 * Хранимые `length_m`/`length_source` ведёт сервер (`erp_roll_recalc`).
 * Запасной расчёт по параметрам нужен рулонам, принятым ДО правки: сервер
 * их не пересчитывал, а показать закройщику «46,30 м (расчёт)» можно и так —
 * параметры материала известны. Записать расход по такому рулону всё равно
 * нельзя, пока сервер не проставит метраж (`erp_material_roll_set_params`).
 */
export function rollWorkingLength(
  roll: RollMetresInput | null | undefined,
  material?: MaterialParams,
): { length: number; source: LengthSource; stored: boolean } | null {
  if (!roll) return null;
  const stored = positive(roll.length_m);
  if (stored !== null) {
    return { length: stored, source: (roll.length_source ?? 'calc') as LengthSource, stored: true };
  }
  const calc = lengthFromWeight(
    roll.qty,
    roll.width_cm ?? material?.width_cm,
    roll.density_gsm ?? material?.density_gsm,
  );
  return calc === null ? null : { length: calc, source: 'calc', stored: false };
}

/** Доступно на начало работы, м: остаток сервера, а без него — весь метраж */
export function rollAvailableM(
  roll: RollMetresInput | null | undefined,
  material?: MaterialParams,
): number | null {
  if (!roll) return null;
  const left = roll.length_left_m;
  if (left !== null && left !== undefined && Number.isFinite(Number(left))) return Math.max(Number(left), 0);
  return rollWorkingLength(roll, material)?.length ?? null;
}

/** Коэффициент рулона: хранимый, а без него — по параметрам */
export function rollKgPerM(
  roll: RollMetresInput | null | undefined,
  material?: MaterialParams,
): number | null {
  if (!roll) return null;
  const stored = positive(roll.kg_per_m);
  if (stored !== null) return stored;
  return kgPerMFromParams(
    roll.width_cm ?? material?.width_cm,
    roll.density_gsm ?? material?.density_gsm,
  );
}

/** Цена за метр рулона: хранимая, а без неё — из цены за кг и коэффициента */
export function rollPricePerM(
  roll: RollMetresInput | null | undefined,
  material?: MaterialParams,
): number | null {
  if (!roll) return null;
  const stored = positive(roll.price_per_m);
  if (stored !== null) return stored;
  return pricePerM(roll.price_per_unit ?? material?.price_per_unit, rollKgPerM(roll, material));
}

/**
 * Каких данных не хватает, чтобы вести рулон в метрах. Пусто — всё есть.
 *
 * Документ: «для расчёта по весу обязательны положительные вес, ширина
 * и плотность. Если есть метраж поставщика или замер, отсутствие плотности
 * не должно мешать учёту в метрах». Поэтому при известном метраже список
 * пуст всегда; иначе называются недостающие из трёх.
 */
export function metresMissing(
  roll: RollMetresInput | null | undefined,
  material?: MaterialParams,
): ('вес' | 'ширина' | 'плотность')[] {
  if (rollWorkingLength(roll, material)) return [];
  const out: ('вес' | 'ширина' | 'плотность')[] = [];
  if (positive(roll?.qty) === null) out.push('вес');
  if (positive(roll?.width_cm ?? material?.width_cm) === null) out.push('ширина');
  if (positive(roll?.density_gsm ?? material?.density_gsm) === null) out.push('плотность');
  return out;
}

/** Подпись «Не заполнены данные для учёта в метрах» — слово в слово с сервером */
export const METRES_MISSING_TEXT = 'Не заполнены данные для учёта в метрах';

/** Подпись источника метража: «расчёт», «замер», «по данным поставщика» */
export function sourceLabel(source: LengthSource | string | null | undefined): string {
  return LENGTH_SOURCE_LABELS[(source ?? 'calc') as LengthSource] ?? String(source);
}
