/**
 * ГАНТ: полоса «начало → конец» на каждый открытый этап (правки 07.09, п. 19).
 *
 * Документ просит режим, где «слева список задач, справа шкала времени,
 * и между стартом и финишем нарисована полоса». Зависимости между этапами
 * документ на первом этапе рисовать не просит — их здесь и нет.
 *
 * ─── ГЛАВНОЕ: ОТКУДА БЕРУТСЯ ДАТЫ ───
 *
 * Строго по плановым датам Гант был бы ПУСТЫМ. На боевой базе к 07.09:
 * `planned_start` заполнен у 3 этапов из 172, `planned_end` — у 14 открытых
 * из 65, `due_date` — у 8 активных заказов из 34. Причина системная и уже
 * записана в правилах проекта: плановую дату пишет форма «Взять в работу»,
 * то есть МОМЕНТ ЗАПУСКА, а `waiting`-этапы (будущее, ради которого диаграмма
 * и заводится) её не получают никогда. Механизм, который на живой базе
 * не даёт результата, — не исполненное требование.
 *
 * Поэтому дата ищется цепочкой, и КАЖДАЯ полоса называет свой источник
 * (`startSource`/`endSource`): догадка, выданная за план, хуже отсутствия
 * полосы — по ней начнут принимать решения о сроках.
 *
 *   начало: `planned_start` → дата `started_at` → `launch_date` заказа
 *   конец:  `planned_end`   → `due_date` заказа
 *
 * КОНЕЦ ГЛАВНЕЕ НАЧАЛА, и это не симметрия. Срок отвечает на вопрос, ради
 * которого в диаграмму и приходят («успеваем ли»), а начало лишь показывает,
 * откуда тянуть полосу. Поэтому:
 *
 * - конца нет ни там ни там — полосы НЕТ ВОВСЕ, строка уходит в `undated`.
 *   Экран обязан назвать такие строки, а не рисовать пустоту: сегодня их
 *   большинство, и молчание читалось бы как «работы нет»;
 * - конец есть, а начала нет ни в одном из трёх источников — полоса стоит
 *   ОДНИМ ДНЁМ в дне срока, `startSource: 'none'`. Растянуть её «от сегодня»
 *   значило бы выдумать длительность работы, которой никто не называл.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ ───
 *
 * Никакого расчёта дат по нормативам участков: `norm_days` пуст у всех
 * четырнадцати участков, каскад не проставил бы ни одной даты (правило
 * сессии 42). Гант ПОКАЗЫВАЕТ то, что ввели люди, и честно говорит, чего
 * они не вводили.
 */

import { addDays, diffDays } from '../../utils/date';
import { isOutsourced } from './outsourcing';
import { deptShortName } from '../data/departments';
import type { ErpDepartment, ErpItemStage, ErpOrderItem } from '../types';
import type { ErpOrderFull } from '../store/types';

/** Откуда взята дата полосы — подписывается у каждой строки */
export type GanttDateSource =
  | 'planned'   // плановая дата этапа: то, о чём договорились
  | 'fact'      // фактический старт: этап уже идёт
  | 'order'     // срок или дата запуска ЗАКАЗА: про этап никто ничего не сказал
  /**
   * Даты нет ни в одном источнике. У конца это означает «полосы не будет»,
   * у начала — «полоса стоит одним днём в дне срока»: длительность работы
   * никто не называл, и выдумывать её нельзя.
   */
  | 'none';

export interface GanttBar {
  stageId: string;
  orderId: string;
  itemId: string;
  /** Номер заказа для строки списка */
  orderTitle: string;
  /** Что за изделие */
  itemTitle: string;
  /** Короткое имя участка */
  deptCode: string;
  deptName: string;
  status: ErpItemStage['status'];
  /** Работу делает подрядчик — это не загрузка нашего цеха */
  outsourced: boolean;
  /** ISO-дата начала; `null` только вместе с `end` — полосы нет */
  start: string | null;
  /** ISO-дата конца; `null` — полосы нет */
  end: string | null;
  startSource: GanttDateSource;
  endSource: GanttDateSource;
  /** Срок прошёл, а этап не закрыт */
  overdue: boolean;
  /** Смещение полосы от начала периода В ДНЯХ (может быть отрицательным) */
  offsetDays: number;
  /** Длительность полосы в днях, минимум 1 — «день в день» это тоже полоса */
  spanDays: number;
}

export interface GanttOptions {
  /** Первый день видимого периода (ISO) */
  from: string;
  /** Сколько дней показываем */
  days: number;
  /** Сегодня — граница просрочки */
  today: string;
}

export interface GanttModel {
  /** Полосы, попавшие в видимый период */
  bars: GanttBar[];
  /**
   * Этапы БЕЗ конечной даты — полосы у них нет. Считаются по всем открытым
   * этапам, без оглядки на период: вопрос «сроки вообще ставят?» границ
   * не имеет (то же правило, что у `buildDeptLoad.totals`).
   */
  undated: GanttBar[];
  /** Даты видимого периода — колонки шкалы */
  dates: string[];
}

const OPEN_STATUSES = new Set(['waiting', 'ready', 'in_progress', 'blocked']);

/** `timestamptz` → календарный день; берём первые 10 символов ISO-строки */
function dayOf(ts: string | null | undefined): string | null {
  return ts ? ts.slice(0, 10) : null;
}

/** Начало полосы и его источник */
function startOf(stage: ErpItemStage, launchDate: string | null): {
  date: string | null; source: GanttDateSource;
} {
  if (stage.planned_start) return { date: stage.planned_start, source: 'planned' };
  const started = dayOf(stage.started_at);
  if (started) return { date: started, source: 'fact' };
  if (launchDate) return { date: launchDate, source: 'order' };
  return { date: null, source: 'none' };
}

/** Конец полосы и его источник */
function endOf(stage: ErpItemStage, dueDate: string | null): {
  date: string | null; source: GanttDateSource;
} {
  if (stage.planned_end) return { date: stage.planned_end, source: 'planned' };
  if (dueDate) return { date: dueDate, source: 'order' };
  return { date: null, source: 'none' };
}

/** Подпись изделия в списке слева */
function itemTitle(item: ErpOrderItem): string {
  const qty = item.qty ?? 0;
  return item.product_type ? `${item.product_type} · ${qty} шт` : `${qty} шт`;
}

/**
 * Полосы Ганта по активным заказам.
 *
 * Подрядные этапы НЕ выбрасываются, в отличие от загрузки цехов: там считались
 * ОБЯЗАТЕЛЬСТВА нашего цеха, и чужая работа дала бы неправду про перегруз.
 * Здесь вопрос другой — «когда что происходит по заказу», и выпавший из
 * диаграммы подряд оставил бы в ней дыру между двумя нашими этапами. Помечены
 * они отдельно (`outsourced`), чтобы это не читалось как наша работа.
 */
export function ganttBars(
  orders: ErpOrderFull[],
  departments: ErpDepartment[],
  { from, days, today }: GanttOptions,
): GanttModel {
  const last = addDays(from, days - 1);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const bars: GanttBar[] = [];
  const undated: GanttBar[] = [];

  for (const order of orders) {
    if (order.status !== 'active') continue;
    for (const item of order.items) {
      for (const stage of item.stages) {
        if (!OPEN_STATUSES.has(stage.status)) continue;
        const dept = deptById.get(stage.department_id);
        const s = startOf(stage, order.launch_date ?? null);
        const e = endOf(stage, order.due_date ?? null);

        /**
         * Полоса рисуется от начала к концу. Начала нет вовсе — она встаёт
         * одним днём в дне срока. Если «начало» оказалось ПОЗЖЕ «конца»
         * (запуск заказа после срока — на живой базе такое бывает от опечатки
         * в паре дат), берём конец: полоса нулевой длины честнее полосы,
         * растущей справа налево.
         */
        const start = !s.date || (e.date && s.date > e.date) ? e.date : s.date;

        const bar: GanttBar = {
          stageId: stage.id,
          orderId: order.id,
          itemId: item.id,
          orderTitle: order.title,
          itemTitle: itemTitle(item),
          deptCode: dept?.code ?? '',
          deptName: dept ? deptShortName(dept.code, dept.name) : '—',
          status: stage.status,
          outsourced: isOutsourced(stage),
          start: e.date ? start : null,
          end: e.date,
          startSource: s.source,
          endSource: e.source,
          overdue: Boolean(e.date && e.date < today),
          offsetDays: 0,
          spanDays: 0,
        };

        if (!bar.end || !bar.start) { undated.push(bar); continue; }
        // Полностью вне видимого периода — в диаграмму не попадает
        if (bar.end < from || bar.start > last) continue;

        bar.offsetDays = diffDays(from, bar.start);
        bar.spanDays = diffDays(bar.start, bar.end) + 1;
        bars.push(bar);
      }
    }
  }

  /**
   * Порядок строк — по началу полосы, затем по сроку: диаграмма читается
   * сверху вниз как «что начинается раньше». `stageId` третьим ключом делает
   * порядок устойчивым: без него две одинаковые по датам строки менялись бы
   * местами от загрузки к загрузке.
   */
  bars.sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1
    : a.end! < b.end! ? -1 : a.end! > b.end! ? 1
      : a.stageId < b.stageId ? -1 : 1));

  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(addDays(from, i));

  return { bars, undated, dates };
}
