/**
 * Позиция задания в очереди цеха (правка 3) — чистая арифметика, покрыта тестами.
 *
 * queue_position — numeric, а не целочисленный индекс: перетаскивание пишет середину
 * между соседями, поэтому меняется одна строка, а не вся очередь. Базовая позиция —
 * epoch срока клиента (см. erp_default_queue_position), отсюда и шаг в сутки.
 */

/** Шаг между соседями при вставке в край очереди — сутки в epoch-шкале базовой позиции */
export const QUEUE_STEP = 86_400;

/**
 * Позиция для задания, вставленного между prev и next.
 * null — соседи «слиплись» по точности double: середину уже не вставить,
 * нужна перенумерация очереди (renumberedQueue).
 */
export function nextQueuePosition(
  prev: number | null | undefined,
  next: number | null | undefined,
): number | null {
  if (prev != null && next != null) {
    const mid = (prev + next) / 2;
    if (!Number.isFinite(mid) || mid <= prev || mid >= next) return null;
    return mid;
  }
  if (prev != null) return prev + QUEUE_STEP;
  if (next != null) return next - QUEUE_STEP;
  // Очередь пуста — стартуем с нуля, шкала внутри цеха относительная
  return 0;
}

/**
 * Базовая позиция задания — зеркало SQL-функции erp_default_queue_position:
 * epoch срока клиента (без срока — условный «через год»), поэтому очередь без
 * ручных правок совпадает с сортировкой по сроку.
 */
export function defaultQueuePosition(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): number {
  const ms = dueDate
    ? Date.parse(`${dueDate}T00:00:00Z`)
    : now.getTime() + 365 * 24 * 3600 * 1000;
  return Math.floor((Number.isNaN(ms) ? now.getTime() : ms) / 1000);
}

/** Перенумеровать очередь с равномерным шагом: id → новая позиция (порядок = порядок массива) */
export function renumberedQueue(ids: string[]): { id: string; queue_position: number }[] {
  return ids.map((id, i) => ({ id, queue_position: i * QUEUE_STEP }));
}

/**
 * Переставить элемент в списке id: `moved` встаёт между prevId и nextId.
 * Отсутствие соседа означает край очереди. Возвращает новый порядок.
 */
export function reorderIds(
  ids: string[],
  moved: string,
  prevId: string | null,
  nextId: string | null,
): string[] {
  const without = ids.filter((id) => id !== moved);
  if (prevId) {
    const i = without.indexOf(prevId);
    if (i >= 0) return [...without.slice(0, i + 1), moved, ...without.slice(i + 1)];
  }
  if (nextId) {
    const i = without.indexOf(nextId);
    if (i >= 0) return [...without.slice(0, i), moved, ...without.slice(i)];
  }
  // Соседей не нашли — в конец (безопаснее, чем терять элемент)
  return [...without, moved];
}
