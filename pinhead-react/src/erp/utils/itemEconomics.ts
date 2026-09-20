import type { ItemEconomics } from '../store/types';

/**
 * ПРЕДСТАВЛЕНИЕ ЭКОНОМИКИ ПОЗИЦИИ (правка заказчика 20.09, п. 9).
 *
 * Здесь НЕТ арифметики себестоимости — её считает `erp_item_economics`
 * на сервере, и второе её определение на клиенте разошлось бы с первым
 * молча. Здесь решается другое: ЧТО показать, как назвать неполноту данных
 * и когда честно сказать «считать не из чего».
 *
 * Почему это вообще отдельный модуль: «посчитано по 40 кг из 61» и «нет
 * цены ни у одного рулона» — разные ответы, и различать их приходится
 * в трёх местах вкладки. Правило раздела — такие решения живут в utils
 * и покрываются тестами, а не в разметке.
 */

/** Чего не хватает, чтобы показатель имел смысл */
export type EconomicsGap =
  | 'no-cutting'   // закрой ещё не сдавал результат
  | 'no-sewing'    // швейка ещё не сдавала годные
  | 'no-price'     // цена материала не заполнена ни у одного использованного рулона
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
  const anyFabric = (e.fabric ?? []).some((f) => f.qty_used > 0);
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
  unit?: string | null,
): string | null {
  const p = Number(priced) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return null;
  if (p >= t) return null;
  const suffix = unit ? ` ${unit}` : '';
  return p > 0
    ? `цена известна для ${round(p)}${suffix} из ${round(t)}${suffix}`
    : 'цена не известна ни для одного рулона';
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
 * Цена ткани берётся у СТРОКИ ЗАКУПКИ, а не у партии (решение владельца
 * 20.09). Оговорка обязательна: при двух поставках по разной цене расчёт
 * усреднён, и умолчать об этом значило бы выдать приближение за факт.
 */
export const PRICE_SOURCE_NOTE = 'по текущей цене строки закупки; '
  + 'при нескольких поставках по разной цене значение усреднено';

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Деньги человеку: «1 234,5 ₽». `null` — прочерк, а не ноль */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

/** Количество с единицей; `null` — прочерк */
export function qty(n: number | null | undefined, unit?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const text = Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}
