/**
 * ПРОИЗВОДСТВЕННЫЙ ПЛЮС ЗАКРОЯ (правка заказчика 21.09, п. 3).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Количество из заказа должно быть ориентиром, а не
 * жёстким ограничением: именно в закройке может появляться производственный
 * плюс… Разрешать скроить по размеру больше количества, указанного в заказе.
 * Разница сверх заказа считается „плюсом" и формируется только на этапе
 * закройки. Например, если в заказе XS = 50, а по всем рулонам скроено
 * XS = 55, система должна сохранить фактический раскрой 55 шт и автоматически
 * зафиксировать плюс XS = 5 шт. Плюсы считать отдельно по каждому размеру
 * и суммарно по позиции».
 *
 * ПЛЮС — ЭТО РАЗНИЦА, А НЕ ВТОРОЕ ЧИСЛО. Он не вводится и не хранится
 * отдельным полем формы: и то и другое дало бы второго писателя одной
 * величины, а разойтись им достаточно одной опечатки. Считается из того,
 * что цех ввёл, и из сетки позиции.
 *
 * СЧИТАЕТСЯ НАКОПИТЕЛЬНО. Закрой сдаёт частями: 30 шт сегодня, 25 завтра.
 * Сравнивать с планом каждую сдачу порознь значило бы не заметить плюс вовсе
 * (30 < 50 и 25 < 50), хотя вместе это 55 при плане 50. Поэтому на вход
 * приходит уже сданное по размерам, и плюс ЭТОЙ сдачи — это прирост
 * превышения, а не превышение целиком.
 *
 * FAIL-OPEN БЕЗ СЕТКИ. У позиции без размерной сетки плана нет, сравнивать
 * не с чем — плюсов не бывает. Объявить плюсом весь раскрой значило бы
 * записать «плюс 200 шт» там, где просто не заполнили сетку; таких позиций
 * на бою почти половина.
 */

import type { SizeGridRow } from '../types';
import { gridCells, NO_COLOR } from './sizeGrid';
import { cellKey } from './cutRolls';
import type { CutRollEntry } from './cutRolls';

/** Плюс по одной ячейке «цвет × размер» */
export interface CutExtraRow {
  color: string;
  size: string;
  /** Подпись человеку: «XS» либо «XS · чёрный» */
  label: string;
  /** Сколько этого размера в заказе */
  planned: number;
  /** Сколько скроено всего — с учётом прежних сдач */
  cut: number;
  /** Плюс ЭТОЙ сдачи: прирост превышения, а не превышение целиком */
  extra: number;
}

export interface CutExtras {
  rows: CutExtraRow[];
  /** Суммарный плюс по позиции */
  total: number;
}

/** Сколько уже сдано по каждой ячейке: ключ `cellKey` → количество */
export type ReportedSizes = Readonly<Record<string, number>>;

/**
 * Сколько сдано по размерам в прежних отчётах ЭТОГО ЖЕ этапа.
 *
 * Отдельная функция, потому что форма и сервер берут строки из разных мест:
 * форма — из загруженных отчётов, сервер — из таблицы. Ключ один и тот же.
 */
export function reportedSizesOf(
  reports: readonly { sizes?: readonly { color?: string | null; size?: string | null;
    qty_good?: number | null }[] | null }[] | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const report of reports ?? []) {
    for (const row of report?.sizes ?? []) {
      const size = (row?.size ?? '').trim();
      if (!size) continue;
      const key = cellKey({ color: row?.color || NO_COLOR, size });
      out[key] = (out[key] ?? 0) + Math.max(Number(row?.qty_good) || 0, 0);
    }
  }
  return out;
}

/**
 * Плюсы по строкам формы закроя.
 *
 * `already` — сданное прежними отчётами этого этапа; пусто, когда сдача
 * первая.
 */
export function cutExtras(
  entries: readonly CutRollEntry[] | null | undefined,
  grid: SizeGridRow[] | null | undefined,
  already: ReportedSizes = {},
): CutExtras {
  const planned = new Map<string, { qty: number; label: string; color: string; size: string }>();
  const cells = gridCells(grid);
  const manyColors = new Set(cells.map((c) => c.color)).size > 1;
  for (const cell of cells) {
    planned.set(cellKey(cell), {
      qty: cell.qty,
      color: cell.color,
      size: cell.size,
      label: manyColors && cell.color !== NO_COLOR ? `${cell.size} · ${cell.color}` : cell.size,
    });
  }
  // Сетки нет — плана нет, плюсов не бывает
  if (planned.size === 0) return { rows: [], total: 0 };

  /** Скроено в ЭТОЙ форме, по ячейкам */
  const now = new Map<string, number>();
  for (const entry of entries ?? []) {
    for (const row of entry?.sizes ?? []) {
      const size = (row?.size ?? '').trim();
      const qty = Math.max(Number(row?.qty) || 0, 0);
      if (!size || qty <= 0) continue;
      const key = cellKey({ color: row.color || NO_COLOR, size });
      now.set(key, (now.get(key) ?? 0) + qty);
    }
  }

  const rows: CutExtraRow[] = [];
  let total = 0;
  for (const [key, qtyNow] of now) {
    const plan = planned.get(key);
    // Размер, которого в заказе нет вовсе, плюсом не считается: это
    // не «сверх плана», а размер вне плана — про него говорит сам факт
    if (!plan) continue;
    const before = Math.max(already[key] ?? 0, 0);
    const extraBefore = Math.max(before - plan.qty, 0);
    const extraAfter = Math.max(before + qtyNow - plan.qty, 0);
    const extra = extraAfter - extraBefore;
    if (extra <= 0) continue;
    rows.push({
      color: plan.color,
      size: plan.size,
      label: plan.label,
      planned: plan.qty,
      cut: before + qtyNow,
      extra,
    });
    total += extra;
  }
  return { rows, total };
}

/**
 * Плюсы человеку одной строкой: «XS — 5 шт · S — 2 шт».
 *
 * Текст собирается здесь, а не в разметке: та же строка нужна и в форме,
 * и в подтверждении превышения, и разойтись им нельзя.
 */
export function cutExtrasText(extras: CutExtras | null | undefined): string {
  return (extras?.rows ?? []).map((r) => `${r.label} — ${r.extra} шт`).join(' · ');
}
