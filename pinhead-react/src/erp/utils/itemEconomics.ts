import type { ItemEconomics, OrderEconomicsRow } from '../store/types';
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

/**
 * «БЕЗ ПОШИВА» (правка 28.09, п. 7): пока стоимость сборки не указана,
 * показатели на единицу посчитаны по одному полотну. Документ требует
 * незаполненную стоимость не принимать за ноль — число без оговорки
 * читалось бы как полная себестоимость.
 */
export const NO_ASSEMBLY_MARK = 'без пошива';

/** Пошив не учтён в затратах позиции (`costs.missing` содержит `assembly`) */
export function missingAssembly(e: ItemEconomics | null | undefined): boolean {
  return (e?.costs?.missing ?? []).includes('assembly');
}

/**
 * Показатель на единицу для показа: `null` — «Нет данных для расчёта»,
 * при неучтённом пошиве — с пометкой «без пошива» рядом с числом.
 */
export function unitCostText(n: number | null | undefined, noAssembly: boolean): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return NO_DATA_TEXT;
  return noAssembly ? `${money(n)} ${NO_ASSEMBLY_MARK}` : money(n);
}

/**
 * СВОДКА ЗАКАЗА (правка 28.09, п. 1): деньги по ВСЕМ позициям заказа —
 * пять строк порознь. В одну сумму «дополнительные расходы» их не сводим:
 * брак, плюсы и отходы уже внутри затрат позиций (прямой запрет документа).
 */
export type OrderSummaryKey = 'total' | 'usable' | 'scrap' | 'defects' | 'extras';

export interface OrderSummaryLine {
  key: OrderSummaryKey;
  label: string;
  /** Сумма по позициям, где значение есть; null — не рассчитано ни у одной */
  sum: number | null;
  /** Позиций, где строка не рассчитана (null) — в сумму не вошли */
  missing: number;
  /** Позиций, где затраты посчитаны без пошива (только для строки затрат) */
  noAssembly: number;
}

const SUMMARY_LINES: { key: OrderSummaryKey; label: string; pick: (e: ItemEconomics) => number | null | undefined }[] = [
  { key: 'total', label: 'Затраты позиций', pick: (e) => e.costs?.total },
  { key: 'usable', label: 'Пригодные остатки ткани', pick: (e) => e.losses?.leftovers_usable_cost },
  { key: 'scrap', label: 'Списанные малые остатки', pick: (e) => e.losses?.leftovers_scrap_cost },
  { key: 'defects', label: 'Окончательный брак', pick: (e) => e.losses?.defects_cost },
  { key: 'extras', label: 'Годные плюсы на складе', pick: (e) => e.losses?.extras?.value },
];

/** Сложить строки сводки по позициям; `null` не превращается в ноль */
export function orderEconomicsSummary(
  rows: readonly OrderEconomicsRow[] | null | undefined,
): OrderSummaryLine[] {
  const list = rows ?? [];
  return SUMMARY_LINES.map(({ key, label, pick }) => {
    let sum: number | null = null;
    let missing = 0;
    let noAssembly = 0;
    for (const r of list) {
      const v = r.economics ? pick(r.economics) : null;
      if (v === null || v === undefined || Number.isNaN(Number(v))) {
        missing += 1;
        continue;
      }
      sum = (sum ?? 0) + Number(v);
      if (key === 'total' && missingAssembly(r.economics)) noAssembly += 1;
    }
    return { key, label, sum, missing, noAssembly };
  });
}

/** Сумма строки сводки: «Не рассчитано», если не рассчитана ни у одной позиции */
export function summaryValueText(line: OrderSummaryLine): string {
  return line.sum === null ? NOT_CALCULATED_TEXT : money(line.sum);
}

/** Оговорка строки сводки: какие позиции в сумму не вошли / посчитаны без пошива */
export function summaryNote(line: OrderSummaryLine): string | null {
  const parts: string[] = [];
  if (line.sum !== null && line.missing > 0) {
    parts.push(`без учёта позиций, где не рассчитано: ${line.missing}`);
  }
  if (line.noAssembly > 0) parts.push(`${NO_ASSEMBLY_MARK}: позиций ${line.noAssembly}`);
  return parts.length ? parts.join(' · ') : null;
}
