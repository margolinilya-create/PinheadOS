/**
 * Очередь «Не запланировано» (правки заказчика 10.08, волна 2).
 *
 * Документ: «В общем плане производства должна быть очередь задач, которые ещё
 * не разложены по дням: только готовые к запуску, ещё не в плане и не в работе».
 *
 * Источник — те же `buildQueueEntries`, что очередь цеха и канбан. Второй
 * реализации «что готово к запуску» здесь нет и быть не должно: гейты по
 * материалам, ТЗ и зависимостям уже посчитаны, и расхождение дало бы
 * «в плане предлагают то, чего цех запустить не может».
 */

import type { QueueEntry } from './filterStages';

/** Статусы, при которых планировать уже поздно или незачем */
const CLOSED = new Set(['done', 'skipped']);

export interface UnplannedOptions {
  /** id этапов, у которых уже есть задача на сегодня или позже */
  plannedStageIds: Iterable<string>;
  /** Ограничить цехом (id); пусто — все участки */
  departmentId?: string | null;
}

/**
 * Задания, которые руководителю ещё предстоит разложить по дням.
 *
 * Берём только `ready`: «ждёт предыдущий этап» и «ждёт материалы» планировать
 * можно, но это уже решение с оговоркой — его человек принимает в модалке
 * постановки, где виден весь список. Очередь же отвечает на вопрос «что можно
 * запускать прямо сейчас и до сих пор не запланировано», и подмешивать в неё
 * ожидающих значило бы утопить ответ.
 *
 * Взятое в работу (`in_progress`) не показываем: оно уже идёт, и постановка
 * в план задним числом — это перепланирование, а не планирование.
 */
export function unplannedEntries(
  entries: QueueEntry[],
  { plannedStageIds, departmentId = null }: UnplannedOptions,
): QueueEntry[] {
  const planned = plannedStageIds instanceof Set
    ? plannedStageIds
    : new Set(plannedStageIds);
  return entries.filter((e) => {
    if (e.group !== 'ready') return false;
    if (CLOSED.has(e.stage.status)) return false;
    if (planned.has(e.stage.id)) return false;
    if (departmentId && e.stage.department_id !== departmentId) return false;
    return true;
  });
}

/** Сколько штук осталось по заданию — количество на день по умолчанию */
export function remainingQty(entry: QueueEntry): number {
  const qty = entry.item.qty ?? 0;
  const done = (entry.stage as { qty_done?: number | null }).qty_done ?? 0;
  return Math.max(1, qty - done);
}
