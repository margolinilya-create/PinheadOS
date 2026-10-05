/**
 * РАЗМЕРНЫЙ ВХОД ЭТАПА (правка заказчика 16.09, п. 6).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Размерная сетка и колонка „Принято из закроя, шт"
 * подтягиваются автоматически из фактического результата этапа „Закрой".
 * Мастер швейного цеха их не вводит вручную… Проверка по каждой строке:
 * Сшито + Брак + В переделку не может превышать количество, фактически
 * принятое из закроя по этому размеру».
 *
 * ПРАВИЛО ТО ЖЕ, ЧТО У `stageInputQty`, И ЭТО НЕ СОВПАДЕНИЕ. Вход этапа —
 * это выход предшественников, а по нескольким параллельным веткам берётся
 * МИНИМУМ, а не сумма: шелкография и ДТФ обрабатывают ОДНИ И ТЕ ЖЕ изделия,
 * и сумма дала бы вдвое больше, чем существует. Здесь тот же обход
 * `depends_on`, только числа считаются по каждому размеру отдельно.
 *
 * FAIL-OPEN — ОБЯЗАТЕЛЬНОЕ УСЛОВИЕ ВЫКАТА. У этапов, закрытых до этой правки,
 * размерных строк нет вовсе: отчёты писались числом. Если бы отсутствие строк
 * читалось как «принято ноль», в день выката встали бы ВСЕ действующие заказы —
 * швейка не смогла бы отчитаться ни за одно изделие. Поэтому нет данных →
 * потолка по размеру нет, и работает прежний общий потолок этапа
 * (`utils/stageOverPlan`), который никуда не делся.
 */

import type { ErpItemStage, ErpStageReport, ErpStageReportSize, SizeGridRow } from '../types';
import { gridCells } from './sizeGrid';
import type { SizeCell } from './sizeGrid';
import { cellKey } from './cellKey';

/** Отчёт вместе с размерными строками — так его отдаёт `loadStageReports` */
export type ReportWithSizes = ErpStageReport & { sizes?: ErpStageReportSize[] };

/** Ключ ячейки: цвет и размер вместе адресуют строку сетки */
export function sizeKey(color: string | null | undefined, size: string): string {
  return cellKey((color ?? '').trim() || '—', size);
}

/** Сколько изделий каждого размера сдал ОДИН этап (сумма его отчётов) */
export function stageSizeOutput(
  stageId: string,
  reports: readonly ReportWithSizes[] | null | undefined,
): Record<string, number> | null {
  const rows = (reports ?? []).filter((r) => r.stage_id === stageId);
  if (rows.length === 0) return null;

  const out: Record<string, number> = {};
  let seen = false;
  for (const report of rows) {
    for (const size of report.sizes ?? []) {
      seen = true;
      const key = sizeKey(size.color, size.size);
      out[key] = (out[key] ?? 0) + Math.max(size.qty_good ?? 0, 0);
    }
  }
  // Отчёты есть, но все они без размерной разбивки — это НЕ «принято ноль»,
  // а «размерных данных нет»: потолка по размеру не существует
  return seen ? out : null;
}

/** Минимум этапа для обхода графа вверх */
type GraphStage = Pick<ErpItemStage, 'id'> & { depends_on?: readonly string[] | null };

/**
 * ВСЕ ПРЕДКИ ЭТАПА по графу `depends_on` — не только прямые (правка 27.09, п. 6).
 *
 * Документ: «сохранять связь с результатом закройки, даже если между
 * закройкой и пошивом есть нанесение». Размерный результат сдаёт закрой,
 * а между ним и швейкой при нанесении на крое стоят вышивка/ДТФ, у которых
 * размерного отчёта нет. Прямые предшественники давали `null`, и столбец
 * «Покроено» показывал прочерки с итогом 0 при «Принято в работу: 472».
 *
 * Обход в ширину с защитой от цикла; этапы вне набора (урезанная выборка)
 * пропускаются — выдумывать по ним нечего.
 */
export function stageAncestors(
  stage: Pick<ErpItemStage, 'depends_on'>,
  allStages: readonly GraphStage[],
): string[] {
  const byId = new Map(allStages.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = [...(stage?.depends_on ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    queue.push(...(byId.get(id)?.depends_on ?? []));
  }
  return [...seen];
}

/**
 * Размерный выход этапа, а если у него размерных данных нет — выход ЕГО
 * предшественников (минимум по веткам), и так вверх до первого этапа
 * с разбивкой. `null` — разбивки нет во всей цепочке.
 */
function sizeOutputThrough(
  stageId: string,
  byId: ReadonlyMap<string, GraphStage>,
  reports: readonly ReportWithSizes[] | null | undefined,
  visiting: Set<string>,
): Record<string, number> | null {
  const own = stageSizeOutput(stageId, reports);
  if (own) return own;
  if (visiting.has(stageId)) return null;
  visiting.add(stageId);
  const outputs = (byId.get(stageId)?.depends_on ?? [])
    .filter((id) => byId.has(id))
    .map((id) => sizeOutputThrough(id, byId, reports, visiting))
    .filter((o): o is Record<string, number> => o !== null);
  visiting.delete(stageId);
  return outputs.length > 0 ? minBySize(outputs) : null;
}

/**
 * МИНИМУМ по веткам, размер за размером: параллельные нанесения проходят
 * одни и те же изделия. Размер, которого нет в какой-то ветке, — это ноль
 * в ней, и минимум по нему тоже ноль.
 */
function minBySize(outputs: readonly Record<string, number>[]): Record<string, number> {
  const keys = new Set(outputs.flatMap((o) => Object.keys(o)));
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = Math.min(...outputs.map((o) => o[key] ?? 0));
  }
  return out;
}

/**
 * Принято на этап по каждому размеру. `null` — размерных данных нет
 * (fail-open: судить не по чему).
 *
 * Предшественник без своей разбивки (нанесение, этап, закрытый кнопкой)
 * ПРОЗРАЧЕН: за него отвечает выход его предшественников (правка 27.09, п. 6).
 * Потолка нет только когда разбивки нет во всей цепочке до начала маршрута.
 */
export function sizeInputFor(
  stage: Pick<ErpItemStage, 'depends_on'>,
  allStages: readonly GraphStage[],
  reports: readonly ReportWithSizes[] | null | undefined,
): Record<string, number> | null {
  const deps = stage?.depends_on ?? [];
  if (deps.length === 0) return null;

  const byId = new Map(allStages.map((s) => [s.id, s]));
  const outputs = deps
    .filter((id) => byId.has(id))
    .map((id) => sizeOutputThrough(id, byId, reports, new Set()))
    .filter((o): o is Record<string, number> => o !== null);

  if (outputs.length === 0) return null;
  return minBySize(outputs);
}

/**
 * Размеры, пришедшие С ПРЕДЫДУЩИХ ЭТАПОВ, вместе с цветом (правка 20.09, п. 8).
 *
 * Зачем отдельно от `sizeInputFor`, который отдаёт `Record<ключ, число>`:
 * из ключа обратно ни цвет, ни размер не достать (цвет бывает из двух слов),
 * а для позиции БЕЗ размерной сетки именно факт закроя и есть единственный
 * источник строк таблицы. Документ просит ровно это: «Размеры и количество
 * „Покроено, шт" должны подтягиваться из этапа закройки».
 */
export function sizeInputCells(
  stage: Pick<ErpItemStage, 'depends_on'>,
  allStages: readonly GraphStage[],
  reports: readonly ReportWithSizes[] | null | undefined,
): SizeCell[] {
  const input = sizeInputFor(stage, allStages, reports);
  if (!input) return [];

  // Цвет и размер берутся из самих строк отчётов: ключ для этого непригоден.
  // Смотрим по всем предкам — разбивка могла прийти через нанесение
  const byKey = new Map<string, { color: string; size: string }>();
  const ancestors = new Set(stageAncestors(stage, allStages));
  for (const report of reports ?? []) {
    if (!report.stage_id || !ancestors.has(report.stage_id)) continue;
    for (const row of report.sizes ?? []) {
      const color = (row.color ?? '').trim() || '—';
      byKey.set(sizeKey(color, row.size), { color, size: row.size });
    }
  }

  return Object.entries(input)
    .map(([key, qty]) => {
      const hit = byKey.get(key);
      return hit ? { color: hit.color, size: hit.size, qty } : null;
    })
    .filter((c): c is SizeCell => c !== null);
}

/** Строка таблицы результата: размер, принято из предыдущего этапа */
export interface SizeInputRow {
  key: string;
  color: string;
  size: string;
  label: string;
  /** Принято на этап; `null` — размерных данных нет */
  expected: number | null;
  /**
   * Осталось из принятых: принято − уже сдано годных − уже списано в брак
   * своими отчётами (правка 27.09, п. 7). `null` — размерных данных нет.
   * Именно остаток, а не «принято», — потолок каждой следующей сдачи.
   */
  remaining: number | null;
  /**
   * Прежние сдачи этого этапа по строке (правка 05.10, п. 3): «при открытии
   * формы показывать полученный крой и все предыдущие сдачи по размерам
   * и цветам». Новая партия вводится отдельно и прибавляется к ним.
   */
  prev: SizeLedgerEntry;
}

/** Сдано своими отчётами по строке: годные, окончательный брак, переделка */
export interface SizeLedgerEntry {
  good: number;
  defect: number;
  rework: number;
}

const EMPTY_LEDGER: SizeLedgerEntry = { good: 0, defect: 0, rework: 0 };

/**
 * Свод прежних сдач этапа по ключу ячейки (правка 05.10, п. 3).
 *
 * Сколько уже сдано годных, списано в окончательный брак и отправлено
 * в переделку — по каждой строке «цвет × размер». Партии складываются,
 * историю ничто не обнуляет и не заменяет планом заказа. Переделка — счётчик
 * отправок: исправленное изделие возвращается ГОДНЫМ следующей сдачей,
 * поэтому остаток в работе считается без неё (иначе одно изделие учлось бы
 * дважды — и в переделке, и в годных).
 */
export function sizeLedger(
  reports: readonly {
    stage_id?: string | null;
    sizes?: readonly {
      color?: string | null; size: string;
      qty_good?: number | null; qty_defect?: number | null; qty_rework?: number | null;
    }[] | null;
  }[] | null | undefined,
  stageId?: string,
): Record<string, SizeLedgerEntry> {
  const out: Record<string, SizeLedgerEntry> = {};
  for (const r of reports ?? []) {
    if (stageId && r.stage_id !== stageId) continue;
    for (const row of r.sizes ?? []) {
      const key = sizeKey(row.color, row.size);
      const acc = out[key] ?? { ...EMPTY_LEDGER };
      acc.good += Math.max(row.qty_good ?? 0, 0);
      acc.defect += Math.max(row.qty_defect ?? 0, 0);
      acc.rework += Math.max(row.qty_rework ?? 0, 0);
      out[key] = acc;
    }
  }
  return out;
}

/**
 * Строки формы: размеры позиции с подставленным «принято из закроя».
 *
 * Сетка берётся у ПОЗИЦИИ, а не у входных данных: мастер обязан видеть все
 * размеры заказа, включая те, которых закрой ещё не сдал (там будет ноль,
 * и это тоже сведение).
 */
export function sizeInputRows(
  grid: SizeGridRow[] | null | undefined,
  input: Record<string, number> | null,
  /**
   * Чем строить таблицу, когда у позиции НЕТ размерной сетки (правка 20.09,
   * п. 8) — размеры, фактически пришедшие с предыдущего этапа.
   *
   * До правки таких строк не появлялось вовсе: `gridCells(null)` пуст,
   * таблица не рисовалась, а вместе с ней исчезало и поле стоимости сборки,
   * жившее внутри той же ветки. На бою сетки нет у 21 позиции из 49 —
   * то есть у половины швейка сдавала результат одним числом.
   */
  fromPrevious: readonly SizeCell[] = [],
  /** Уже учтено своими отчётами по ключу ячейки (`reportedAccountedBySize`) */
  accounted: Record<string, number> = {},
  /** Свод прежних сдач (`sizeLedger`) — для колонок «сдано ранее» */
  ledger: Record<string, SizeLedgerEntry> = {},
): SizeInputRow[] {
  const cells = gridCells(grid);
  const source = cells.length > 0 ? cells : fromPrevious;
  return source.map((cell: SizeCell) => {
    const key = sizeKey(cell.color, cell.size);
    const expected = input ? (input[key] ?? 0) : null;
    return {
      key,
      color: cell.color,
      size: cell.size,
      label: cell.color === '—' ? cell.size : `${cell.size} · ${cell.color}`,
      expected,
      remaining: expected === null ? null : Math.max(expected - (accounted[key] ?? 0), 0),
      prev: ledger[key] ?? EMPTY_LEDGER,
    };
  });
}

/** Сколько мастер ввёл по строке: сшито + брак + переделка */
export function rowEntered(values: Record<string, unknown> | null | undefined): number {
  return ['good', 'defect', 'rework']
    .reduce((sum, code) => sum + Math.max(Number(values?.[code]) || 0, 0), 0);
}

/**
 * Почему результат нельзя сдать. `null` — можно.
 *
 * Текст называет ОБА числа и размер: «превышение» без цифр отправляет мастера
 * пересчитывать таблицу заново. То же правило, что у `overPlanBlock`.
 */
export function sizeReportBlock(
  rows: readonly SizeInputRow[] | null | undefined,
  values: Record<string, Record<string, unknown>> | null | undefined,
): string | null {
  for (const row of rows ?? []) {
    // Размерных данных нет — потолка по размеру не существует (fail-open)
    if (row.remaining === null) continue;
    const entered = rowEntered(values?.[row.key]);
    /**
     * Потолок — ОСТАТОК из принятых, а не «принято» (правка 27.09, п. 7):
     * прежние сдачи этого же этапа уже забрали своё. Слова совпадают
     * с отказом `erp_stage_submit_report` — один текст в форме и в ответе.
     */
    if (entered > row.remaining) {
      return `${row.label}: больше ${row.remaining} шт сдать нельзя — столько осталось`
        + ` из принятых (введено ${entered})`;
    }
  }
  return null;
}

/** Итоги таблицы по колонкам */
export function sizeTotals(
  rows: readonly SizeInputRow[] | null | undefined,
  values: Record<string, Record<string, unknown>> | null | undefined,
): { good: number; defect: number; rework: number; expected: number; remaining: number } {
  const acc = { good: 0, defect: 0, rework: 0, expected: 0, remaining: 0 };
  for (const row of rows ?? []) {
    acc.expected += Math.max(row.expected ?? 0, 0);
    acc.remaining += Math.max(row.remaining ?? 0, 0);
    for (const code of ['good', 'defect', 'rework'] as const) {
      acc[code] += Math.max(Number(values?.[row.key]?.[code]) || 0, 0);
    }
  }
  return acc;
}

/** Разбивка для отчёта этапа: только непустые строки */
export function sizeReportPayload(
  rows: readonly SizeInputRow[] | null | undefined,
  values: Record<string, Record<string, unknown>> | null | undefined,
): { color: string; size: string; qty_good: number; qty_defect: number; qty_rework: number }[] {
  return (rows ?? [])
    .map((row) => ({
      color: row.color,
      size: row.size,
      qty_good: Math.max(Number(values?.[row.key]?.good) || 0, 0),
      qty_defect: Math.max(Number(values?.[row.key]?.defect) || 0, 0),
      qty_rework: Math.max(Number(values?.[row.key]?.rework) || 0, 0),
    }))
    .filter((row) => row.qty_good + row.qty_defect + row.qty_rework > 0);
}
