import type {
  AnalyticsSnapshot,
  AnalyticsOverview,
} from '../store/types';

/**
 * ВЫГРУЗКА РАЗДЕЛА «АНАЛИТИКА» В CSV (правка 27.09, п. 5).
 *
 * Чистое форматирование, без DOM: компонент только заворачивает строку
 * в Blob и отдаёт файл. Формат выбран под Excel с русской локалью:
 *   · разделитель `;` — запятая занята десятичной частью;
 *   · BOM UTF-8 в начале — без него Excel читает файл как cp1251,
 *     и кириллица превращается в кракозябры;
 *   · дробные числа с ЗАПЯТОЙ и без разделителя разрядов — иначе Excel
 *     примет «112.5» за дату или текст, а «1 234,5» за текст;
 *   · `null` — пустая ячейка, а не «—» и не 0: пустота в таблице значит
 *     «нет данных», ноль — «ноль», и путать их нельзя (тот же принцип,
 *     что у плиток экрана);
 *   · переводы строк `\r\n` — так их ждёт Excel.
 *
 * Единицы — в заголовках («Ткань, м», «Расход, м/изделие»), а не в ячейках:
 * ячейка с « м» — текст, по ней не посчитать сумму.
 *
 * Отметки «расчёт» и «неполные данные» идут отдельными колонками во всех
 * разделах, где их несут данные: сводка, «Динамика выпуска» (с правки 28.09
 * сервер отдаёт `fabric_calc`/`fabric_incomplete` по каждой строке)
 * и «Расход полотна по моделям». Значение — «да»/«нет»; флаг, которого
 * сервер не прислал, — пустая ячейка («нет данных»), как у всех чисел.
 */

export const CSV_SEP = ';';
export const CSV_BOM = '﻿';
const EOL = '\r\n';

/** Знаков после запятой: хватает метрам на изделие, срезает шум float */
const MAX_DECIMALS = 4;

/** Число → «112,5»; null/undefined/нечисло — пустая ячейка */
export function csvNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const rounded = Number(n.toFixed(MAX_DECIMALS));
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}

/** Флаг → «да»/«нет»; отсутствующий — пусто */
export function csvFlag(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v ? 'да' : 'нет';
}

/** Текстовая ячейка: кавычки, если внутри разделитель, кавычка или перевод строки */
export function csvText(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells: string[]) => cells.join(CSV_SEP);

export interface AnalyticsCsvOptions {
  /** Детализация динамики: подпись первой колонки */
  bucket?: 'day' | 'week';
  /** id цеха → имя (для раздела «Брак и переделка по цехам») */
  deptNames?: Map<string, string>;
}

function overviewLines(o: AnalyticsOverview): string[] {
  const rows: Array<[string, string]> = [
    ['Выпущено изделий, шт', csvNumber(o.released)],
    ['Выпущено в прошлом периоде, шт', csvNumber(o.released_prev)],
    ['Брак, шт', csvNumber(o.defect)],
    ['Переделка, шт', csvNumber(o.rework)],
    ['Количество плюсов, шт', csvNumber(o.extra)],
    ['Средняя себестоимость сборки, ₽/шт', csvNumber(o.assembly_avg)],
    ['Покрыто себестоимостью, шт', csvNumber(o.assembly_covered_qty)],
    // Ноль метров при нуле скроенного — «нет данных», а не «ноль ткани»
    ['Использовано ткани, м', o.fabric_m > 0 ? csvNumber(o.fabric_m) : ''],
    ['Годных скроено, шт', csvNumber(o.fabric_cut_good)],
    ['Средний расход ткани, м/изделие', csvNumber(o.fabric_per_item)],
    ['Рулонов в работе', csvNumber(o.fabric_rolls)],
    ['Расчёт (часть строк пересчитана из кг)', csvFlag(o.fabric_calc)],
    ['Неполные данные (часть строк не пересчитана)', csvFlag(o.fabric_incomplete)],
  ];
  return [
    line(['Сводка']),
    line(['Показатель', 'Значение']),
    ...rows.map(([k, v]) => line([csvText(k), v])),
  ];
}

/** Весь снимок аналитики — одним CSV с разделами через пустую строку */
export function analyticsCsv(
  snapshot: AnalyticsSnapshot,
  { bucket = 'day', deptNames }: AnalyticsCsvOptions = {},
): string {
  const o = snapshot.overview;
  const blocks: string[][] = [];

  const head = [line(['Аналитика производства'])];
  if (o) {
    head.push(line(['Период', csvText(o.from), csvText(o.to)]));
    head.push(line(['Сравнение с', csvText(o.prev_from), csvText(o.prev_to)]));
  }
  blocks.push(head);

  if (o) blocks.push(overviewLines(o));

  blocks.push([
    line(['Динамика выпуска']),
    line([
      bucket === 'week' ? 'Неделя' : 'День', 'Выпущено, шт', 'Брак, шт', 'Переделка, шт',
      'Плюсы, шт', 'Ткань, м', 'Расчёт', 'Неполные данные',
    ]),
    ...(snapshot.series ?? []).map((r) => line([
      csvText(r.bucket), csvNumber(r.released), csvNumber(r.defect),
      csvNumber(r.rework), csvNumber(r.extra), csvNumber(r.fabric),
      csvFlag(r.fabric_calc), csvFlag(r.fabric_incomplete),
    ])),
  ]);

  blocks.push([
    line(['Расход полотна по моделям']),
    line([
      'Изделие', 'Материал', 'Ширина, см', 'Ткань, м', 'Годных скроено, шт',
      'Расход, м/изделие', 'Расчёт', 'Неполные данные', 'Заказов',
    ]),
    ...(snapshot.fabricBySku ?? []).map((r) => line([
      csvText(r.product_type), csvText(r.material), csvNumber(r.width_cm),
      csvNumber(r.fabric_m), csvNumber(r.cut_good), csvNumber(r.per_item),
      csvFlag(r.calc), csvFlag(r.incomplete), csvNumber(r.orders),
    ])),
  ]);

  blocks.push([
    line(['Производство по моделям']),
    line(['Изделие', 'Выпущено, шт', 'Брак, шт', 'Брак, %', 'Сборка, ₽/шт', 'Заказов']),
    ...(snapshot.bySku ?? []).map((r) => line([
      csvText(r.product_type), csvNumber(r.released), csvNumber(r.defect),
      csvNumber(r.defect_pct), csvNumber(r.assembly_avg), csvNumber(r.orders),
    ])),
  ]);

  blocks.push([
    line(['Брак и переделка по цехам']),
    line(['Цех', 'Сдано, шт', 'Брак, шт', 'В переделку, шт', 'Брак, %']),
    ...(snapshot.byDept ?? []).map((r) => line([
      csvText(deptNames?.get(r.department_id) ?? r.department_id), csvNumber(r.done_qty),
      csvNumber(r.defect), csvNumber(r.rework), csvNumber(r.defect_pct),
    ])),
  ]);

  return CSV_BOM + blocks.map((b) => b.join(EOL)).join(EOL + EOL) + EOL;
}

/** Имя файла: ASCII, с периодом — чтобы две выгрузки не перезаписали друг друга */
export function analyticsCsvFileName(overview: AnalyticsOverview | null): string {
  return overview
    ? `analytics-${overview.from}_${overview.to}.csv`
    : 'analytics.csv';
}
