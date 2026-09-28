import type { ItemEconomics } from '../store/types';
import { fmtM } from './fabricMetres';

/**
 * ПРЕДСТАВЛЕНИЕ ЭКОНОМИКИ ПОЗИЦИИ (правка заказчика 20.09, п. 9; метры
 * и «Остатки и потери» — 27.09, пп. 4 и 8).
 *
 * Здесь НЕТ арифметики себестоимости — её считает `erp_item_economics`
 * на сервере, и второе её определение на клиенте разошлось бы с первым
 * молча. Здесь решается другое: ЧТО показать, как назвать неполноту данных
 * и когда честно сказать «считать не из чего».
 */

/** Чего не хватает, чтобы показатель имел смысл */
export type EconomicsGap =
  | 'no-cutting'   // закрой ещё не сдавал результат
  | 'no-sewing'    // швейка ещё не сдавала годные
  | 'no-price'     // цена не нашлась ни у одного метра расхода
  | 'no-assembly'; // стоимость сборки не называл никто

/**
 * Чего не хватает для полного расчёта. Пусто — всё на месте.
 *
 * Порядок ВАЖЕН: он совпадает с порядком производства, и человек читает
 * список как «где остановилось», а не как набор упрёков.
 */
export function economicsGaps(e: ItemEconomics | null | undefined): EconomicsGap[] {
  if (!e) return ['no-cutting', 'no-sewing', 'no-price', 'no-assembly'];
  const gaps: EconomicsGap[] = [];
  if (!(e.qty_cut > 0)) gaps.push('no-cutting');
  if (!(e.qty_good > 0)) gaps.push('no-sewing');
  const anyFabric = (e.fabric?.metres ?? 0) > 0 || (e.fabric?.incomplete_kg ?? 0) > 0;
  if (anyFabric && !(Number(e.fabric_cost_total) > 0)) gaps.push('no-price');
  if (e.assembly?.avg === null || e.assembly?.avg === undefined) gaps.push('no-assembly');
  return gaps;
}

export const GAP_LABELS: Record<EconomicsGap, string> = {
  'no-cutting': 'закрой ещё не сдавал результат по рулонам',
  'no-sewing': 'швейка ещё не сдавала годные изделия',
  'no-price': 'у использованных рулонов не заполнена закупочная цена',
  'no-assembly': 'не указана стоимость сборки единицы',
};

/** Статьи, которых нет в составе затрат (ключи `costs.missing` сервера) */
export const COST_MISSING_LABELS: Record<'fabric' | 'fabric_price' | 'assembly', string> = {
  fabric: 'основное полотно (расход ещё не сдан)',
  fabric_price: 'цена части полотна (нет цены за метр или коэффициента рулона)',
  assembly: 'пошив (стоимость сборки не указана)',
};

/**
 * Подпись к среднему: по какой доле расхода цена нашлась.
 *
 * Тот же приём, что `assembly_covered_qty` в сводке: среднее, посчитанное
 * по трети расхода, читается как среднее по всему, если не сказать, сколько
 * в него вошло. `null` — оговорка не нужна (цена есть у всего).
 */
export function coverageNote(
  priced: number | null | undefined,
  total: number | null | undefined,
): string | null {
  const p = Number(priced) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return null;
  if (p >= t - 0.005) return null;
  return p > 0
    ? `цена известна для ${fmtM(p)} из ${fmtM(t)}`
    : 'цена не известна ни для одного рулона';
}

/**
 * Подпись расхода полотна: сколько пересчитано из кг («Расчёт») и сколько
 * пересчитать не из чего — документ требует называть неполноту словами.
 */
export function fabricNote(e: ItemEconomics | null | undefined): string | null {
  const f = e?.fabric;
  if (!f) return null;
  const parts: string[] = [];
  if (f.calc_metres > 0) parts.push(`${fmtM(f.calc_metres)} пересчитано из кг по коэффициенту рулона (расчёт)`);
  if (f.incomplete_kg > 0) parts.push(`${f.incomplete_kg} кг не пересчитано: у рулонов нет коэффициента`);
  return parts.length ? parts.join(' · ') : null;
}

/** Подпись источника стоимости сборки — «откуда это число» */
export function assemblySourceNote(e: ItemEconomics | null | undefined): string | null {
  if (!e?.assembly) return null;
  if (e.assembly.source === 'item_fallback') {
    return 'взята из позиции заказа: отчёты швейки цену не называли';
  }
  if (e.assembly.source === 'reports') {
    return e.assembly.covered_qty > 0
      ? `средневзвешенная по ${e.assembly.covered_qty} шт`
      : null;
  }
  return null;
}

/**
 * Цена ткани берётся у РУЛОНА — снимком на момент приёмки (правка 21.09),
 * а стоимость операции — снимком на момент сдачи (27.09): правка
 * справочника закрытые операции не меняет.
 */
export const PRICE_SOURCE_NOTE = 'по цене за метр рулона на момент сдачи; '
  + 'у рулонов, принятых до учёта в метрах, — по цене за кг';

/** Подпись показателя на клиентский тираж — слово в слово с документом */
export const PLAN_COST_NOTE = 'Все затраты позиции распределены на клиентский тираж, включая изготовление плюсов';

/** Подпись итога себестоимости, пока учитываются только полотно и пошив */
export const COST_SCOPE_NOTE = 'Основное полотно и пошив на единицу';

/** «Нет данных для расчёта» — при нулевом знаменателе (документ) */
export const NO_DATA_TEXT = 'Нет данных для расчёта';

/** «Не рассчитано» — там, где стоимость нельзя определить (документ: не ноль) */
export const NOT_CALCULATED_TEXT = 'Не рассчитано';

/** Деньги человеку: «1 234,5 ₽». `null` — прочерк, а не ноль */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

/** Деньги там, где пустота значит «не рассчитано», а не «нет» */
export function moneyOrNot(n: number | null | undefined): string {
  return n === null || n === undefined ? NOT_CALCULATED_TEXT : money(n);
}

/** Количество с единицей; `null` — прочерк */
export function qty(n: number | null | undefined, unit?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const text = Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}

/** Разбивка по размерам и цветам одной строкой: «M — 5 шт, L · чёрный — 3 шт» */
export function sizeRowsText(
  rows: readonly { color?: string | null; size: string; qty: number }[] | null | undefined,
): string {
  return (rows ?? [])
    .filter((r) => r.qty > 0)
    .map((r) => `${r.size}${r.color && r.color !== '—' ? ` · ${r.color}` : ''} — ${r.qty} шт`)
    .join(', ');
}
