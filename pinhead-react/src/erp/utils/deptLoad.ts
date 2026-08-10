/**
 * Загрузка цехов по дням — из плановых дат этапов.
 *
 * Мощностей (шт/день) в схеме нет: колонки `capacity_per_day`/`target_load_per_day`
 * удалены миграцией 20260716170000 с решением «план сроков вписывается вручную».
 * Поэтому сравниваем не с нормой, а с собственным максимумом цеха за период —
 * это отвечает на вопрос «где на неделе пик и что вообще без плана», не
 * возвращая отвергнутую заказчиком идею мощностей.
 *
 * Единица счёта — остаток позиции (`qty - qty_done`) на дату `planned_end`
 * этапа: это день, к которому цех обязался закрыть работу.
 */

import { addDays, mondayOfWeek } from '../../utils/date';
import type { ErpDepartment } from '../types';
import type { ErpOrderFull } from '../store/types';

export interface LoadCell {
  /** ISO-дата (YYYY-MM-DD) */
  date: string;
  /** Штук к сдаче в этот день */
  qty: number;
  /** Сколько этапов дают эти штуки */
  stages: number;
}

export interface LoadGroup {
  qty: number;
  stages: number;
}

export interface LoadRow {
  dept: ErpDepartment;
  cells: LoadCell[];
  /** Этапы без плановой даты — их не видно ни в одном дне */
  unplanned: LoadGroup;
  /** Просроченные: план в прошлом, этап не закрыт */
  overdue: LoadGroup;
  /** Сумма штук по видимым дням */
  total: number;
}

export interface DeptLoad {
  rows: LoadRow[];
  /** Максимум по всем ячейкам — шкала заливки */
  maxCell: number;
}

/**
 * N подряд идущих дат от startISO включительно.
 * Сложение дат — `utils/date`: `toISOString().slice(0,10)` считает дату в UTC
 * и восточнее Гринвича отдавал вчерашнюю (та же поломка, что на доске плана).
 */
export function loadDays(startISO: string, count = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(addDays(startISO, i));
  return out;
}

/** Понедельник недели, в которую попадает дата */
export function weekStart(iso: string): string {
  return mondayOfWeek(iso);
}

const OPEN_STATUSES = new Set(['waiting', 'ready', 'in_progress', 'blocked']);

/**
 * Сетка «цех × день». `days` задаёт видимый период, `today` — граница просрочки.
 * Цеха без единой работы за период и без хвостов в сетку не попадают.
 */
export function buildDeptLoad(
  orders: ErpOrderFull[],
  departments: ErpDepartment[],
  days: string[],
  today: string,
): DeptLoad {
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const rows = new Map<string, LoadRow>();
  for (const dept of departments) {
    rows.set(dept.id, {
      dept,
      cells: days.map((date) => ({ date, qty: 0, stages: 0 })),
      unplanned: { qty: 0, stages: 0 },
      overdue: { qty: 0, stages: 0 },
      total: 0,
    });
  }

  for (const order of orders) {
    if (order.status !== 'active') continue;
    for (const item of order.items) {
      for (const stage of item.stages) {
        if (!OPEN_STATUSES.has(stage.status)) continue;
        const row = rows.get(stage.department_id);
        if (!row) continue;

        const left = Math.max((item.qty ?? 0) - (stage.qty_done ?? 0), 0);
        const planned = stage.planned_end;

        if (!planned) {
          row.unplanned.qty += left;
          row.unplanned.stages += 1;
          continue;
        }
        if (planned < today) {
          row.overdue.qty += left;
          row.overdue.stages += 1;
          continue;
        }
        const i = dayIndex.get(planned);
        if (i === undefined) continue; // план вне видимого периода
        row.cells[i].qty += left;
        row.cells[i].stages += 1;
        row.total += left;
      }
    }
  }

  const visible = [...rows.values()].filter(
    (r) => r.total > 0 || r.unplanned.stages > 0 || r.overdue.stages > 0,
  );
  visible.sort((a, b) => b.total - a.total || a.dept.sort_order - b.dept.sort_order);

  const maxCell = visible.reduce(
    (max, r) => r.cells.reduce((m, c) => Math.max(m, c.qty), max),
    0,
  );

  return { rows: visible, maxCell };
}
